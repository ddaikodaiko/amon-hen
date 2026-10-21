import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Profile, ProfileName } from "../config";
import type { Database } from "../db";
import { healthClosedUntil } from "../ingest/health";
import { runLoop, type TraceStep } from "./loop";
import type { ModelClient } from "./model";
import systemPrompt from "./prompts/system.md" with { type: "text" };
import { transition } from "./queue";
import { toolDefinitions } from "./tools";
import type { Verdict } from "./tools/submit_verdict";

// Candidate → loop → escalation (FR-010) → dossier. The dossier, its evidence and its trace are
// written in one transaction, or not at all: a run cut short by the model leaves nothing.

export interface InvestigateDeps {
  primary: ModelClient;
  /** The higher profile, tried when the primary says inconclusive. */
  escalate?: ModelClient | null;
  profiles: Record<ProfileName, Profile>;
  capUsd: number;
  now?: () => number;
}

export type Outcome =
  | { state: "investigated"; dossierId: number; verdict: Verdict; escalated: boolean }
  | { state: "error"; reason: string }
  | { state: "pending_no_model"; reason: string }
  | { state: "pending_budget" };

interface CandidateRow {
  id: number;
  mmsi: number;
  gap_start: number;
  gap_end: number | null;
  start_lat: number;
  start_lon: number;
  end_lat: number | null;
  end_lon: number | null;
  ais_class: "A" | "B";
  nav_status_start: number | null;
}

/**
 * The code behind what the model reads and how it is asked: the prompt, this briefing, the loop with
 * its nudges and limits, the client, and each tool with the summaries it writes. Hashing only the
 * tool schemas let a tool answer differently under the same version (SC-008, review-sc008.md). What
 * the tools call outside src/agent (the coverage, the geometry) is left out.
 */
const VERSIONED = ["prompts", "tools", "investigate.ts", "loop.ts", "model.ts"];
const sourceHash = (() => {
  const h = createHash("sha256");
  const files = VERSIONED.flatMap((p) => {
    const path = join(import.meta.dir, p);
    return statSync(path).isDirectory() ? readdirSync(path).map((f) => join(p, f)) : [p];
  });
  for (const f of files.sort()) h.update(f).update(readFileSync(join(import.meta.dir, f)));
  return h.digest("hex");
})();

/** Hash of the agent's code, the tool schemas as sent and the profile: what makes two dossiers comparable. */
export function agentVersion(client: ModelClient): string {
  const h = createHash("sha256");
  h.update(sourceHash);
  h.update(JSON.stringify(toolDefinitions({ strict: client.strictTools })));
  h.update(`${client.profile}:${client.model}`);
  return h.digest("hex").slice(0, 12);
}

const NAV_STATUS: Record<number, string> = {
  0: "under way using engine",
  1: "at anchor",
  2: "not under command",
  3: "restricted manoeuvrability",
  4: "constrained by draught",
  5: "moored",
  6: "aground",
  7: "engaged in fishing",
  8: "under way sailing",
};

const iso = (ts: number) => new Date(ts).toISOString().replace(/\.\d{3}Z$/, "Z");
const where = (lat: number, lon: number) => `${lat.toFixed(5)} N, ${lon.toFixed(5)} E`;
function duration(ms: number): string {
  const min = Math.round(ms / 60_000);
  return min < 60 ? `${min} minutes` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

/** The first message of the investigation, in English. */
export function briefing(c: CandidateRow, now: number): string {
  const status = c.nav_status_start === null ? "" : ` (navigation status ${c.nav_status_start}, ${NAV_STATUS[c.nav_status_start] ?? "other"})`;
  const lines = [
    "Investigate this AIS gap.",
    `Vessel: MMSI ${c.mmsi}, class ${c.ais_class} transponder.`,
    `Last position before the silence: ${iso(c.gap_start)} at ${where(c.start_lat, c.start_lon)}${status}.`,
    c.gap_end !== null && c.end_lat !== null && c.end_lon !== null
      ? `It reported again at ${iso(c.gap_end)} at ${where(c.end_lat, c.end_lon)}: a gap of ${duration(c.gap_end - c.gap_start)}.`
      : `It has not reported again: silent for ${duration(now - c.gap_start)} as of ${iso(now)}.`,
  ];
  return lines.join("\n");
}

const sum = (steps: TraceStep[], k: "input_tokens" | "output_tokens" | "cost_usd") => steps.reduce((s, x) => s + x[k], 0);

export async function investigate(db: Database, candidateId: number, deps: InvestigateDeps): Promise<Outcome> {
  const now = deps.now ?? Date.now;
  const c = db.query<CandidateRow, [number]>("SELECT * FROM candidates WHERE id = ?").get(candidateId);
  if (c === null) throw new Error(`candidate ${candidateId} does not exist`);
  transition(db, c.id, "investigating", now());
  const down = await deps.primary.unavailable();
  if (down !== null) {
    transition(db, c.id, "pending_no_model", now());
    return { state: "pending_no_model", reason: down };
  }
  const t0 = performance.now();
  // An open gap is described as of the newest minute we know, not the clock: old imports stay right.
  const asOf = Math.min(now(), healthClosedUntil(db) ?? now());
  const loop = (client: ModelClient, firstIdx: number) =>
    runLoop({
      db,
      client,
      profile: deps.profiles[client.profile],
      capUsd: deps.capUsd,
      system: systemPrompt,
      briefing: briefing(c, asOf),
      mmsi: c.mmsi,
      gap: { start: c.gap_start, end: c.gap_end },
      firstIdx,
      now,
    });

  const first = await loop(deps.primary, 0);
  if (first.end.kind !== "verdict") {
    const outcome: Outcome =
      first.end.kind === "budget"
        ? { state: "pending_budget" }
        : first.end.kind === "no_model"
          ? { state: "pending_no_model", reason: first.end.reason }
          : { state: "error", reason: first.end.reason };
    transition(db, c.id, outcome.state, now());
    return outcome;
  }

  let verdict = first.end.verdict;
  let client = deps.primary;
  const steps = [...first.steps];
  if (verdict.verdict === "inconclusive" && deps.escalate) {
    const second = await loop(deps.escalate, steps.length);
    steps.push(...second.steps);
    if (second.end.kind === "verdict") {
      verdict = second.end.verdict;
      client = deps.escalate;
    } else {
      const why = second.end.kind === "budget" ? "it could go over the monthly cap" : second.end.reason;
      steps.push({
        idx: steps.length,
        kind: "error",
        tool: null,
        input_json: "{}",
        output_summary: `Escalation to ${deps.escalate.profile} stopped: ${why}. The ${deps.primary.profile} verdict stands.`,
        output_json: null,
        model: null,
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
        duration_ms: 0,
        ts: now(),
      });
    }
  }

  const escalated = client !== deps.primary;
  // Immediate: it reads before it writes, and the recorder writes to the same file from another
  // process; a deferred one fails with SQLITE_BUSY_SNAPSHOT instead of waiting (2026-10-20).
  const dossierId = db.transaction(() => {
    const version =
      (db.query<{ v: number | null }, [number]>("SELECT max(version) AS v FROM dossiers WHERE candidate_id = ?").get(c.id)?.v ?? 0) + 1;
    const id = db
      .query<{ id: number }, (string | number)[]>(
        `INSERT INTO dossiers (candidate_id, version, verdict, confidence, explanation, profile, escalated,
           input_tokens, output_tokens, cost_usd, duration_ms, agent_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .get(
        c.id,
        version,
        verdict.verdict,
        verdict.confidence,
        verdict.explanation,
        client.profile,
        escalated ? 1 : 0,
        sum(steps, "input_tokens"),
        sum(steps, "output_tokens"),
        sum(steps, "cost_usd"),
        Math.round(performance.now() - t0),
        agentVersion(client),
        now(),
      )!.id;
    const step = db.query(
      `INSERT INTO trace_steps (dossier_id, idx, kind, tool, input_json, output_summary, output_json, model,
         input_tokens, output_tokens, cost_usd, duration_ms, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const s of steps) {
      step.run(id, s.idx, s.kind, s.tool, s.input_json, s.output_summary, s.output_json, s.model, s.input_tokens, s.output_tokens, s.cost_usd, s.duration_ms, s.ts);
    }
    const evidence = db.query("INSERT INTO evidence (dossier_id, step_idx, claim) VALUES (?, ?, ?)");
    for (const e of verdict.evidence) evidence.run(id, e.step, e.claim);
    transition(db, c.id, "investigated", now());
    return id;
  }).immediate();
  return { state: "investigated", dossierId, verdict, escalated };
}
