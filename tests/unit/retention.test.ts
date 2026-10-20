import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/db";
import { KEEP_MS, prune, prunePositions } from "../../src/ingest/retention";

// 30 days of positions and raw archive, except the windows already recorded (T060).

const H = 3_600_000;
// Half past, so the cutoff falls inside an hour file.
const NOW = Date.UTC(2026, 9, 20, 12, 30);
const CUTOFF = NOW - KEEP_MS;
const dir = mkdtempSync(join(tmpdir(), "vigia-retention-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function world() {
  const db = openDb(":memory:");
  db.run("INSERT INTO vessels (mmsi, flag_mid, updated_at) VALUES (230000001, 230, 0)");
  const add = db.query("INSERT INTO positions (mmsi, ts, lat, lon) VALUES (230000001, ?, 60, 25)");
  // One a minute from 40 days ago to now.
  for (let t = NOW - 40 * 24 * H; t < NOW; t += 60_000) add.run(t);
  // A demo exported from 35 days ago, two hours long.
  const window = { start: NOW - 35 * 24 * H, end: NOW - 35 * 24 * H + 2 * H };
  db.query("INSERT INTO recordings (start_ts, end_ts, kind, path) VALUES (?, ?, 'demo', 'demo/x.sqlite')").run(window.start, window.end);
  return { db, window };
}

const hourFile = (root: string, t: number, gz = true) => {
  const iso = new Date(t).toISOString();
  const day = join(root, iso.slice(0, 10));
  mkdirSync(day, { recursive: true });
  const path = join(day, `${iso.slice(11, 13)}.ndjson${gz ? ".gz" : ""}`);
  writeFileSync(path, "x");
  return path;
};

describe("retention", () => {
  test("positions older than 30 days go, except those of a recorded window", async () => {
    const { db, window } = world();
    const count = (sql: string, ...args: number[]) => db.query<{ n: number }, number[]>(`SELECT count(*) AS n FROM positions WHERE ${sql}`).get(...args)!.n;
    const inWindow = count("ts >= ? AND ts < ?", window.start, window.end);
    const recent = count("ts >= ?", CUTOFF);
    const pruned = await prune(db, join(dir, "none"), NOW);
    expect(pruned.positions).toBe(10 * 24 * 60 - inWindow);
    expect(count("ts < ?", CUTOFF)).toBe(inWindow);
    expect(count("ts >= ? AND ts < ?", window.start, window.end)).toBe(120);
    expect(count("ts >= ?", CUTOFF)).toBe(recent);
  });

  test("in batches: the result is the same", async () => {
    const { db } = world();
    expect(await prunePositions(db, CUTOFF, 1000)).toBe(10 * 24 * 60 - 120);
  });

  test("raw hour files that end before the cutoff go, the recorded ones stay, and emptied days are removed", async () => {
    const { db, window } = world();
    const root = join(dir, "raw");
    const old = hourFile(root, NOW - 40 * 24 * H);
    const oldPlain = hourFile(root, NOW - 40 * 24 * H + H, false);
    const recorded = hourFile(root, window.start);
    // The hour the cutoff falls in still has data to keep.
    const straddling = hourFile(root, CUTOFF - 10 * 60_000);
    const recent = hourFile(root, NOW - H);
    const pruned = await prune(db, root, NOW);
    expect(pruned.files).toBe(2);
    expect([old, oldPlain, recorded, straddling, recent].map(existsSync)).toEqual([false, false, true, true, true]);
    expect(readdirSync(root)).not.toContain(new Date(NOW - 40 * 24 * H).toISOString().slice(0, 10));
  });
});
