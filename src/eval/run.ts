import { agentVersion, investigate } from "../agent/investigate";
import type { ModelClient } from "../agent/model";
import type { Profile, ProfileName } from "../config";
import type { Database } from "../db";

// `bun run eval --profile`: the labelled cases investigated again with one profile, on its own
// (no escalation), so the report measures that model.

export interface EvalRunDeps {
  client: ModelClient;
  profiles: Record<ProfileName, Profile>;
  capUsd: number;
  /** Ask again even where a dossier of this exact agent version exists. */
  fresh?: boolean;
  now?: () => number;
  onCase?: (done: number, total: number, outcome: string) => void;
}

export interface EvalRun {
  agentVersion: string;
  investigated: number;
  /** Cases that already had a dossier of this version. */
  reused: number;
  errors: number;
  /** Why it stopped before the end: the cap, or the model. */
  stopped: string | null;
}

export async function investigateLabeled(db: Database, deps: EvalRunDeps): Promise<EvalRun> {
  const version = agentVersion(deps.client);
  const run: EvalRun = { agentVersion: version, investigated: 0, reused: 0, errors: 0, stopped: null };
  const cases = db
    .query<{ id: number; state: string }, []>(
      "SELECT c.id, c.state FROM labels l JOIN candidates c ON c.id = l.candidate_id ORDER BY c.gap_start, c.id",
    )
    .all();
  const done = db.query<{ one: number }, [number, string, string]>(
    "SELECT 1 AS one FROM dossiers WHERE candidate_id = ? AND profile = ? AND escalated = 0 AND agent_version = ?",
  );
  for (const [i, c] of cases.entries()) {
    if (!deps.fresh && done.get(c.id, deps.client.profile, version) !== null) {
      run.reused++;
      continue;
    }
    // Someone else (the live server) is on it.
    if (c.state === "investigating") {
      run.errors++;
      deps.onCase?.(i + 1, cases.length, `case ${c.id} is being investigated elsewhere, skipped`);
      continue;
    }
    const out = await investigate(db, c.id, {
      primary: deps.client,
      escalate: null,
      profiles: deps.profiles,
      capUsd: deps.capUsd,
      now: deps.now,
    });
    deps.onCase?.(i + 1, cases.length, `case ${c.id}: ${out.state === "investigated" ? out.verdict.verdict : out.state}`);
    if (out.state === "investigated") run.investigated++;
    else if (out.state === "error") run.errors++;
    else {
      run.stopped = out.state === "pending_budget" ? "the monthly cap would be exceeded" : `the model does not answer (${out.reason})`;
      break;
    }
  }
  return run;
}
