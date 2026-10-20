import { type Database, openDb } from "../db";
import { computeCoverage } from "./compute";

// The hourly coverage recompute, off the server's thread: over 7 days of positions it takes tens
// of seconds, and the server must keep answering meanwhile. It opens its own connection (WAL).

declare const self: Worker;

export interface CoverageJob {
  dbPath: string;
  windowEnd: number;
}

export type CoverageResult = { ok: true; cells: number } | { ok: false; error: string };

self.onmessage = (e: MessageEvent<CoverageJob>) => {
  let db: Database | null = null;
  try {
    db = openDb(e.data.dbPath);
    const { cells } = computeCoverage(db, e.data.windowEnd);
    postMessage({ ok: true, cells } satisfies CoverageResult);
  } catch (err) {
    postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) } satisfies CoverageResult);
  } finally {
    db?.close();
  }
};
