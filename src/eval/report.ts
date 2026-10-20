import type { ProfileName } from "../config";
import type { Database } from "../db";
import type { DiscardReason, EvalMetrics, EvalReport, LabelValue, VerdictValue } from "../shared/api";
import { costs, scores } from "./metrics";
import { naiveDark } from "./naive";
import { stopping } from "./stopping";

// The eval report (FR-020, R12): the agent and the 60-minute rule against the human labels.

export interface ReportOptions {
  /** Take, for each case, the newest dossier of this profile run on its own at this agent version. */
  profile?: { name: ProfileName; agentVersion: string };
  now?: number;
}

interface Labeled {
  id: number;
  gap_start: number;
  gap_end: number | null;
  value: LabelValue;
}

interface DossierRow {
  candidate_id: number;
  verdict: VerdictValue;
  profile: ProfileName;
  cost_usd: number;
  agent_version: string;
}

export function buildReport(db: Database, opts: ReportOptions = {}): Omit<EvalReport, "id"> {
  const labeled = db
    .query<Labeled, []>(
      "SELECT c.id, c.gap_start, c.gap_end, l.value FROM labels l JOIN candidates c ON c.id = l.candidate_id ORDER BY c.gap_start, c.id",
    )
    .all();
  const p = opts.profile;
  const newest = db.query<DossierRow, (string | number)[]>(
    `SELECT candidate_id, verdict, profile, cost_usd, agent_version FROM dossiers
     WHERE candidate_id = ? ${p === undefined ? "" : "AND profile = ? AND escalated = 0 AND agent_version = ?"}
     ORDER BY version DESC LIMIT 1`,
  );
  const judged = labeled.flatMap((c) => {
    const d = newest.get(c.id, ...(p === undefined ? [] : [p.name, p.agentVersion]));
    return d === null ? [] : [{ label: c.value, dark: d.verdict === "likely_dark", dossier: d }];
  });

  const discarded: Record<DiscardReason, number> = { own_outage: 0, left_region: 0, berth: 0 };
  if (labeled.length > 0) {
    const rows = db
      .query<{ reason: DiscardReason; n: number }, [number, number]>(
        `SELECT discard_reason AS reason, count(*) AS n FROM candidates
         WHERE state = 'discarded' AND gap_start >= ? AND gap_start <= ? GROUP BY 1`,
      )
      .all(labeled[0]!.gap_start, labeled.at(-1)!.gap_start);
    for (const r of rows) discarded[r.reason] = r.n;
  }

  const n_positive = labeled.filter((c) => c.value === "likely_dark").length;
  const metrics: EvalMetrics = {
    agent: scores(judged),
    naive: scores(labeled.map((c) => ({ label: c.value, dark: naiveDark(c) }))),
    cost: costs(judged.map((j) => j.dossier)),
    stopping: stopping(labeled.length, n_positive),
    not_investigated: labeled.length - judged.length,
    discarded,
  };
  const versions = [...new Set(judged.map((j) => j.dossier.agent_version))].sort();
  return {
    created_at: opts.now ?? Date.now(),
    agent_version: p?.agentVersion ?? (versions.length === 0 ? "none" : versions.join(",")),
    profile: p?.name ?? null,
    n_labeled: labeled.length,
    n_positive,
    n_undeterminable: labeled.filter((c) => c.value === "undeterminable").length,
    stopping_rule_met: metrics.stopping.met,
    metrics,
  };
}

export function saveReport(db: Database, r: Omit<EvalReport, "id">): number {
  return db
    .query<{ id: number }, (string | number | null)[]>(
      `INSERT INTO eval_reports (created_at, agent_version, profile, n_labeled, n_positive, n_undeterminable,
         stopping_rule_met, metrics_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(r.created_at, r.agent_version, r.profile, r.n_labeled, r.n_positive, r.n_undeterminable, r.stopping_rule_met ? 1 : 0, JSON.stringify(r.metrics))!
    .id;
}

type ReportRow = Omit<EvalReport, "stopping_rule_met" | "metrics"> & { stopping_rule_met: number; metrics_json: string };

/** The newest first. */
export function listReports(db: Database): EvalReport[] {
  return db
    .query<ReportRow, []>("SELECT * FROM eval_reports ORDER BY created_at DESC, id DESC")
    .all()
    .map(({ metrics_json, stopping_rule_met, ...r }) => ({
      ...r,
      stopping_rule_met: stopping_rule_met === 1,
      metrics: JSON.parse(metrics_json) as EvalMetrics,
    }));
}
