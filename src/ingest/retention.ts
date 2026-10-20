import { existsSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "../db";

// 30 days of positions and raw archive in live mode (data-model.md, R4). The windows registered
// in `recordings` are kept whole: the demo and the eval set can be rebuilt from the full data.

const DAY = 24 * 3_600_000;
export const KEEP_MS = 30 * DAY;
/** Rows per DELETE: between batches the ingest gets the event loop back. */
export const BATCH = 50_000;

export interface Window {
  start_ts: number;
  end_ts: number;
}

export interface Pruned {
  positions: number;
  files: number;
}

const kept = (windows: readonly Window[], start: number, end: number) => windows.some((w) => w.start_ts < end && start < w.end_ts);

export async function prunePositions(db: Database, cutoff: number, batch = BATCH): Promise<number> {
  const del = db.query(
    `DELETE FROM positions WHERE rowid IN (
       SELECT p.rowid FROM positions p
       WHERE p.ts < ? AND NOT EXISTS (SELECT 1 FROM recordings r WHERE p.ts >= r.start_ts AND p.ts < r.end_ts)
       LIMIT ?)`,
  );
  let total = 0;
  for (;;) {
    const n = del.run(cutoff, batch).changes;
    total += n;
    if (n < batch) return total;
    await Bun.sleep(0);
  }
}

/** Deletes the hour files (data/raw/YYYY-MM-DD/HH.ndjson[.gz]) that end before `cutoff`, and the emptied days. */
export function pruneArchive(root: string, cutoff: number, windows: readonly Window[]): number {
  if (!existsSync(root)) return 0;
  let files = 0;
  for (const day of readdirSync(root)) {
    if (!/^\d{4}-\d\d-\d\d$/.test(day)) continue;
    const dir = join(root, day);
    for (const file of readdirSync(dir)) {
      const hour = /^(\d\d)\.ndjson(\.gz)?$/.exec(file);
      if (hour === null) continue;
      const start = Date.parse(`${day}T${hour[1]}:00:00Z`);
      if (start + 3_600_000 > cutoff || kept(windows, start, start + 3_600_000)) continue;
      unlinkSync(join(dir, file));
      files++;
    }
    if (readdirSync(dir).length === 0) rmdirSync(dir);
  }
  return files;
}

export async function prune(db: Database, rawRoot: string, now: number, keepMs = KEEP_MS): Promise<Pruned> {
  const cutoff = now - keepMs;
  const windows = db.query<Window, []>("SELECT start_ts, end_ts FROM recordings").all();
  const positions = await prunePositions(db, cutoff);
  return { positions, files: pruneArchive(rawRoot, cutoff, windows) };
}
