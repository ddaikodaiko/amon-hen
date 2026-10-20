import { statSync } from "node:fs";
import { type InvestigateDeps, investigate } from "../agent/investigate";
import type { Database } from "../db";
import { record } from "./record";

// `bun run demo:build` (T047): the demo database, built from the main one. The window's cases are
// investigated first, on the full data, and only then reduced to a position a minute; the briefs
// and eval reports there are go with it.

export const MAX_DEMO_BYTES = 50_000_000;

export interface DemoBuildOptions {
  from: number;
  to: number;
  out: string;
  investigate: InvestigateDeps;
  maxBytes?: number;
  onCase?: (id: number, outcome: string) => void;
}

export interface DemoBuild {
  investigated: number;
  positions: number;
  candidates: number;
  dossiers: number;
  briefs: number;
  reports: number;
  bytes: number;
}

export class DemoBuildError extends Error {}

export async function buildDemo(db: Database, o: DemoBuildOptions): Promise<DemoBuild> {
  // The window's cases without a dossier, in order of arrival.
  const todo = db
    .query<{ id: number }, [number, number]>(
      `SELECT c.id FROM candidates c
       WHERE c.gap_start >= ? AND c.gap_start < ? AND c.state IN ('pending', 'pending_no_model', 'pending_budget', 'error')
         AND NOT EXISTS (SELECT 1 FROM dossiers d WHERE d.candidate_id = c.id)
       ORDER BY c.trigger_at, c.id`,
    )
    .all(o.from, o.to);
  let investigated = 0;
  for (const { id } of todo) {
    const out = await investigate(db, id, o.investigate);
    o.onCase?.(id, out.state === "investigated" ? out.verdict.verdict : out.state);
    if (out.state === "pending_no_model") throw new DemoBuildError(`the model does not answer (${out.reason}): demo:build needs it`);
    if (out.state === "pending_budget") throw new DemoBuildError("the monthly cap would be exceeded: use the local profile, or raise VIGIA_BUDGET_USD");
    if (out.state === "investigated") investigated++;
  }

  const stats = record(db, { from: o.from, to: o.to, kind: "demo", out: o.out });
  // The briefs whose 24 h overlap the window, and every eval report: the demo shows them as they are.
  db.run("ATTACH DATABASE ? AS out", [o.out]);
  let briefs = 0;
  let reports = 0;
  try {
    db.transaction(() => {
      briefs = db
        .query(
          `INSERT INTO out.briefs SELECT * FROM main.briefs
           WHERE json_extract(sections_json, '$.window.start') < ? AND json_extract(sections_json, '$.window.end') > ?`,
        )
        .run(o.to, o.from).changes;
      reports = db.query("INSERT INTO out.eval_reports SELECT * FROM main.eval_reports").run().changes;
    })();
  } finally {
    db.run("DETACH DATABASE out");
  }
  const bytes = statSync(o.out).size;
  const max = o.maxBytes ?? MAX_DEMO_BYTES;
  if (bytes > max) {
    throw new DemoBuildError(`${o.out} is ${(bytes / 1e6).toFixed(1)} MB, over the ${(max / 1e6).toFixed(0)} MB of a demo: take a shorter window`);
  }
  return { investigated, positions: stats.positions, candidates: stats.candidates, dossiers: stats.dossiers, briefs, reports, bytes };
}
