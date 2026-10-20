import { z } from "zod";
import { monthOf, spentIn } from "../../agent/budget";
import { type CandidateState, canTransition, retrigger, STATES } from "../../agent/queue";
import { VERDICTS } from "../../agent/tools/submit_verdict";
import { PROFILE_NAMES } from "../../config";
import type { Database } from "../../db";
import { flagOf } from "../../geo/mid";
import { nearestPlace } from "../../geo/places";
import { shipTypeLabel } from "../../geo/ship-type";
import type * as Api from "../../shared/api";
import { caseContext } from "../case-context";
import { HttpError, readOptionalJson, type Route } from "../http";
import { vesselInfo } from "./map";
import { instant, parse } from "./parse";

export const PAGE_SIZE = 50;

/** What the list shows without a state filter: the cases, not the gaps the detector threw out. */
const CASE_STATES = STATES.filter((s) => s !== "detected" && s !== "discarded");

// The shared types must stay what the server writes.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const sameStates: Same<CandidateState, Api.CandidateState> = true;
const sameVerdicts: Same<(typeof VERDICTS)[number], Api.VerdictValue> = true;
void sameStates, sameVerdicts;

const ListQuery = z.object({
  state: z
    .string()
    .transform((s) => s.split(","))
    .pipe(z.array(z.enum(STATES)).min(1))
    .optional(),
  verdict: z.enum(VERDICTS).optional(),
  from: instant.optional(),
  to: instant.optional(),
  page: z.coerce.number().int().min(1).default(1),
});

interface Row {
  id: number;
  mmsi: number;
  name: string | null;
  ship_type: number | null;
  ais_class: "A" | "B";
  gap_start: number;
  gap_end: number | null;
  start_lat: number;
  start_lon: number;
  end_lat: number | null;
  end_lon: number | null;
  state: CandidateState;
  discard_reason: Api.DiscardReason | null;
  trigger_at: number | null;
  started_at: number | null;
  nav_status_start: number | null;
  created_at: number;
  d_version: number | null;
  d_verdict: Api.VerdictValue | null;
  d_confidence: Api.Confidence | null;
  d_profile: Api.ProfileName | null;
  d_escalated: number | null;
  d_cost_usd: number | null;
}

const SELECT = `
  SELECT c.*, v.name, v.ship_type,
         d.version AS d_version, d.verdict AS d_verdict, d.confidence AS d_confidence,
         d.profile AS d_profile, d.escalated AS d_escalated, d.cost_usd AS d_cost_usd
  FROM candidates c
  JOIN vessels v ON v.mmsi = c.mmsi
  LEFT JOIN dossiers d ON d.candidate_id = c.id
   AND d.version = (SELECT max(version) FROM dossiers WHERE candidate_id = c.id)`;

function summary(r: Row): Api.CandidateSummary {
  return {
    id: r.id,
    mmsi: r.mmsi,
    name: r.name,
    flag: flagOf(r.mmsi),
    type_label: shipTypeLabel(r.ship_type),
    ais_class: r.ais_class,
    gap_start: r.gap_start,
    gap_end: r.gap_end,
    duration_min: r.gap_end === null ? null : Math.round((r.gap_end - r.gap_start) / 60_000),
    start: { lat: r.start_lat, lon: r.start_lon },
    end: r.end_lat === null || r.end_lon === null ? null : { lat: r.end_lat, lon: r.end_lon },
    state: r.state,
    discard_reason: r.discard_reason,
    near: nearestPlace(r.start_lat, r.start_lon),
    trigger_at: r.trigger_at,
    started_at: r.started_at,
    dossier:
      r.d_version === null
        ? null
        : {
            version: r.d_version,
            verdict: r.d_verdict!,
            confidence: r.d_confidence!,
            profile: r.d_profile!,
            escalated: r.d_escalated === 1,
            cost_usd: r.d_cost_usd!,
          },
  };
}

const list: Route = {
  method: "GET",
  path: "/api/candidates",
  handler: ({ url, app }) => {
    const q = parse(ListQuery, Object.fromEntries(url.searchParams), "query");
    const states = q.state ?? CASE_STATES;
    const where = [`c.state IN (${states.map(() => "?").join(", ")})`];
    const args: (string | number)[] = [...states];
    if (q.verdict !== undefined) where.push("d.verdict = ?"), args.push(q.verdict);
    if (q.from !== undefined) where.push("c.gap_start >= ?"), args.push(q.from);
    if (q.to !== undefined) where.push("c.gap_start < ?"), args.push(q.to);
    const sql = `${SELECT} WHERE ${where.join(" AND ")}`;
    const total = app.db.query<{ n: number }, (string | number)[]>(`SELECT count(*) AS n FROM (${sql})`).get(...args)!.n;
    const rows = app.db
      .query<Row, (string | number)[]>(`${sql} ORDER BY c.gap_start DESC, c.id DESC LIMIT ? OFFSET ?`)
      .all(...args, PAGE_SIZE, (q.page - 1) * PAGE_SIZE);
    const body: Api.CandidateList = { items: rows.map(summary), total, page: q.page, page_size: PAGE_SIZE };
    return Response.json(body);
  },
};

const idParam = z.coerce.number().int().positive();

function candidateRow(db: Database, raw: string | undefined): Row {
  const id = parse(idParam, raw, "candidate id");
  const row = db.query<Row, [number]>(`${SELECT} WHERE c.id = ?`).get(id);
  if (row === null) throw new HttpError(404, "not_found", `candidate ${id} does not exist`);
  return row;
}

type DossierRow = Omit<Api.Dossier, "escalated" | "evidence" | "steps"> & { escalated: number };

const detail: Route = {
  method: "GET",
  path: "/api/candidates/:id",
  handler: async ({ params, app }) => {
    const row = candidateRow(app.db, params.id);
    const vessel = vesselInfo(app.db, row.mmsi)!;
    const evidence = app.db.query<Api.Evidence, [number]>("SELECT step_idx AS step, claim FROM evidence WHERE dossier_id = ? ORDER BY rowid");
    const steps = app.db.query<Api.TraceStep, [number]>(
      `SELECT idx, kind, tool, input_json, output_summary, output_json, model, input_tokens, output_tokens, cost_usd, duration_ms, ts
       FROM trace_steps WHERE dossier_id = ? ORDER BY idx`,
    );
    const dossiers = app.db
      .query<DossierRow, [number]>(
        `SELECT id, version, verdict, confidence, explanation, profile, escalated, input_tokens, output_tokens,
                cost_usd, duration_ms, agent_version, created_at
         FROM dossiers WHERE candidate_id = ? ORDER BY version`,
      )
      .all(row.id)
      .map((d): Api.Dossier => ({ ...d, escalated: d.escalated === 1, evidence: evidence.all(d.id), steps: steps.all(d.id) }));
    const body: Api.CandidateDetail = {
      candidate: {
        ...summary(row),
        nav_status_start: row.nav_status_start,
        created_at: row.created_at,
        vessel,
      },
      context: await caseContext(app.db, row.id),
      dossiers,
    };
    return Response.json(body);
  },
};

const ReinvestigateBody = z.object({ profile: z.enum(PROFILE_NAMES).default("local") }).strict();

const reinvestigate: Route = {
  method: "POST",
  path: "/api/candidates/:id/reinvestigate",
  write: true,
  handler: async ({ req, params, app }) => {
    const row = candidateRow(app.db, params.id);
    const body = parse(ReinvestigateBody, await readOptionalJson(req, {}), "body");
    if (app.investigator === undefined) throw new HttpError(409, "no_investigator", "this server does not investigate");
    if (row.state !== "investigating" && !canTransition(row.state, "investigating")) {
      throw new HttpError(409, "invalid_state", `a ${row.state} candidate cannot be investigated`);
    }
    const profile = app.config.profiles[body.profile];
    if (profile.paid) {
      if (profile.apiKey === undefined) throw new HttpError(409, "no_api_key", `the ${profile.name} profile needs ANTHROPIC_API_KEY`);
      const spent = spentIn(app.db, monthOf(Date.now()));
      if (spent >= app.config.budgetUsd) {
        throw new HttpError(409, "over_budget", `this month's cap of ${app.config.budgetUsd} USD is spent (${spent.toFixed(4)} USD)`);
      }
    }
    // A case already past the queue is triggered again; one waiting in it keeps its place.
    if (row.state === "investigated" || row.state === "error" || row.state === "pending_budget") retrigger(app.db, row.id);
    const position = app.investigator.enqueue(row.id, body.profile);
    const out: Api.Reinvestigation = { queued: true, profile: body.profile, position };
    return Response.json(out, { status: 202 });
  },
};

export const CANDIDATE_ROUTES: Route[] = [list, detail, reinvestigate];
