import { rmSync, statSync } from "node:fs";
import { type Database, openDb } from "../db";
import { SCANNED_UNTIL } from "../detect/run";
import { CLOSED_UNTIL } from "../ingest/health";

// `bun run record`: a time window copied to a database of its own, for the demo (FR-024) or for
// the eval set. Ids are kept, so dossiers, steps and evidence still point at each other.

export type RecordingKind = "demo" | "eval";

export interface RecordOptions {
  from: number;
  to: number;
  kind: RecordingKind;
  out: string;
}

export interface RecordStats {
  positions: number;
  vessels: number;
  candidates: number;
  dossiers: number;
  steps: number;
  labels: number;
  bytes: number;
}

/**
 * The demo keeps the first position of each vessel in each minute; the eval set keeps them all.
 * The demo is only replayed: the detector run on it would see some gaps start up to 30 s
 * earlier, as new ones.
 */
const POSITIONS: Record<RecordingKind, string> = {
  demo: `SELECT mmsi, ts, lat, lon, sog, cog, heading, nav_status FROM (
           SELECT *, row_number() OVER (PARTITION BY mmsi, ts / 60000 ORDER BY ts) AS n
           FROM main.positions WHERE ts >= $from AND ts < $to)
         WHERE n = 1`,
  eval: "SELECT mmsi, ts, lat, lon, sog, cog, heading, nav_status FROM main.positions WHERE ts >= $from AND ts < $to",
};

export function record(src: Database, opts: RecordOptions): RecordStats {
  if (opts.to <= opts.from) throw new Error("--to must come after --from");
  for (const suffix of ["", "-wal", "-shm", "-journal"]) rmSync(`${opts.out}${suffix}`, { force: true });
  // Created with the schema, then filled from the source connection.
  openDb(opts.out).close();
  src.run("ATTACH DATABASE ? AS out", [opts.out]);
  const w = { from: opts.from, to: opts.to };
  const run = (sql: string) => src.query(sql).run(w).changes;
  let stats: Omit<RecordStats, "bytes">;
  try {
    stats = src.transaction(() => {
      run(`CREATE TEMP TABLE window_candidates AS SELECT id FROM main.candidates WHERE gap_start >= $from AND gap_start < $to`);
      run(`CREATE TEMP TABLE window_positions AS ${POSITIONS[opts.kind]}`);
      const vessels = run(
        `INSERT INTO out.vessels SELECT * FROM main.vessels WHERE mmsi IN (
           SELECT mmsi FROM temp.window_positions UNION SELECT mmsi FROM main.candidates WHERE id IN (SELECT id FROM temp.window_candidates))`,
      );
      const positions = run("INSERT INTO out.positions SELECT * FROM temp.window_positions");
      run("INSERT INTO out.ingest_minutes SELECT * FROM main.ingest_minutes WHERE minute_ts >= $from AND minute_ts < $to");
      run("INSERT INTO out.outages SELECT * FROM main.outages WHERE start_ts < $to AND (end_ts IS NULL OR end_ts > $from)");
      // The 7-day aggregate the agent looked at.
      run("INSERT INTO out.coverage SELECT * FROM main.coverage");
      const candidates = run("INSERT INTO out.candidates SELECT * FROM main.candidates WHERE id IN (SELECT id FROM temp.window_candidates)");
      const dossiers = run("INSERT INTO out.dossiers SELECT * FROM main.dossiers WHERE candidate_id IN (SELECT id FROM temp.window_candidates)");
      const steps = run("INSERT INTO out.trace_steps SELECT * FROM main.trace_steps WHERE dossier_id IN (SELECT id FROM out.dossiers)");
      run("INSERT INTO out.evidence SELECT * FROM main.evidence WHERE dossier_id IN (SELECT id FROM out.dossiers)");
      // The labels are the eval's ground truth; the public demo does not carry them.
      const labels =
        opts.kind === "eval" ? run("INSERT INTO out.labels SELECT * FROM main.labels WHERE candidate_id IN (SELECT id FROM temp.window_candidates)") : 0;
      // The detector and the health are done up to the end of the window: nothing to redo there.
      for (const key of [SCANNED_UNTIL, CLOSED_UNTIL]) {
        src.query("INSERT INTO out.meta (key, value) VALUES (?, ?)").run(key, String(opts.to));
      }
      const recording = [opts.from, opts.to, opts.kind, opts.out] as const;
      src.query("INSERT INTO out.recordings (start_ts, end_ts, kind, path) VALUES (?, ?, ?, ?)").run(...recording);
      src.query("INSERT INTO main.recordings (start_ts, end_ts, kind, path) VALUES (?, ?, ?, ?)").run(...recording);
      run("DROP TABLE temp.window_candidates");
      run("DROP TABLE temp.window_positions");
      return { positions, vessels, candidates, dossiers, steps, labels };
    })();
  } finally {
    src.run("DETACH DATABASE out");
  }
  // One self-contained file: no WAL, so it can be shipped and opened read-only.
  const out = openDb(opts.out);
  out.run("PRAGMA journal_mode = DELETE");
  out.run("VACUUM");
  out.close();
  return { ...stats, bytes: statSync(opts.out).size };
}
