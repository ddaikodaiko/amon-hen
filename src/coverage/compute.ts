import type { Database } from "../db";
import type { Outage } from "../detect/exclusions";
import type { Fix } from "../detect/gaps";
import { Grid } from "../geo/grid";
import { distanceNm } from "../geo/haversine";

// Coverage in vessel-minutes (FR-004, R6). Each vessel's track is followed minute by minute,
// gaps included; a minute is expected when the vessel moves at more than 3 knots (then class A
// reports every 10 s and class B every 30 s, so every minute should have a message), and
// received when a position was stored in it. coverage = received / expected, per cell and UTC
// hour of the day, over the last 7 days.

const MIN = 60_000;
export const MIN_KNOTS = 3;
export const SAMPLE_MIN = 30;
export const WINDOW_MS = 7 * 24 * 60 * MIN;
/** Longer silences are not followed: the vessel may have left the region and come back. */
const MAX_FOLLOW_MS = 6 * 60 * MIN;

const DEFAULT_GRID = new Grid();

export interface Tally {
  expected: number;
  received: number;
}

/** cell_id * 24 + hour_utc */
const keyOf = (cell: number, ts: number) => cell * 24 + new Date(ts).getUTCHours();

const knotsBetween = (a: Fix, b: Fix) => (b.ts > a.ts ? distanceNm(a, b) / ((b.ts - a.ts) / 3_600_000) : 0);

function inOutage(outages: readonly Outage[], minute: number): boolean {
  return outages.some((o) => o.start_ts <= minute && (o.end_ts === null || minute < o.end_ts));
}

/** Adds one vessel's minutes (fixes sorted by time) to `into`. */
export function vesselMinutes(
  fixes: readonly Fix[],
  outages: readonly Outage[],
  grid: Grid,
  into: Map<number, Tally> = new Map(),
): Map<number, Tally> {
  const add = (lat: number, lon: number, minute: number, knots: number, received: boolean) => {
    if (knots <= MIN_KNOTS || inOutage(outages, minute)) return;
    const cell = grid.cellId(lat, lon);
    if (cell === null) return;
    const k = keyOf(cell, minute);
    const t = into.get(k) ?? { expected: 0, received: 0 };
    t.expected++;
    if (received) t.received++;
    into.set(k, t);
  };

  let lastMinute = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < fixes.length; i++) {
    const a = fixes[i]!;
    const b = fixes[i + 1];
    const minute = Math.floor(a.ts / MIN) * MIN;
    // The first fix of a minute stands for it.
    if (minute > lastMinute) {
      const neighbour = b ?? fixes[i - 1];
      add(a.lat, a.lon, minute, a.sog ?? (neighbour === undefined ? 0 : knotsBetween(a, neighbour)), true);
      lastMinute = minute;
    }
    if (b === undefined || b.ts - a.ts > MAX_FOLLOW_MS) continue;
    // The silent minutes up to b's, placed on the straight line from a to b at their middle.
    const knots = knotsBetween(a, b);
    for (let m = minute + MIN; m < Math.floor(b.ts / MIN) * MIN; m += MIN) {
      const f = (m + MIN / 2 - a.ts) / (b.ts - a.ts);
      add(a.lat + (b.lat - a.lat) * f, a.lon + (b.lon - a.lon) * f, m, knots, false);
    }
  }
  return into;
}

export interface CoverageOptions {
  grid?: Grid;
}

function windowTallies(db: Database, from: number, to: number, grid: Grid, mmsi?: number): Map<number, Tally> {
  const outages = db
    .query<Outage, [number, number]>("SELECT start_ts, end_ts FROM outages WHERE start_ts < ? AND (end_ts IS NULL OR end_ts > ?)")
    .all(to, from);
  const fixesOf = db.query<Fix, [number, number, number]>(
    "SELECT ts, lat, lon, sog, cog, nav_status FROM positions WHERE mmsi = ? AND ts >= ? AND ts < ? ORDER BY ts",
  );
  const vessels =
    mmsi !== undefined
      ? [mmsi]
      : db
          .query<{ mmsi: number }, [number, number]>("SELECT DISTINCT mmsi FROM positions WHERE ts >= ? AND ts < ?")
          .all(from, to)
          .map((r) => r.mmsi);
  const tallies = new Map<number, Tally>();
  for (const v of vessels) vesselMinutes(fixesOf.all(v, from, to), outages, grid, tallies);
  return tallies;
}

/** Recomputes the `coverage` table over the 7 days before `windowEnd`. */
export function computeCoverage(db: Database, windowEnd: number, opts: CoverageOptions = {}): { cells: number } {
  const grid = opts.grid ?? DEFAULT_GRID;
  const from = windowEnd - WINDOW_MS;
  const tallies = windowTallies(db, from, windowEnd, grid);
  const insert = db.query(
    "INSERT INTO coverage (cell_id, hour_utc, expected_min, received_min, window_start, window_end) VALUES (?, ?, ?, ?, ?, ?)",
  );
  db.transaction(() => {
    db.run("DELETE FROM coverage");
    for (const [k, t] of tallies) insert.run(Math.floor(k / 24), k % 24, t.expected, t.received, from, windowEnd);
  })();
  return { cells: tallies.size };
}

export interface CellCoverage {
  cell_id: number;
  hour_utc: number;
  expected_min: number;
  received_min: number;
  /** Null when no vessel was expected there. */
  ratio: number | null;
  sample_ok: boolean;
}

/**
 * Coverage of the cell around (lat, lon) at that UTC hour, null outside the grid. With
 * `excludeMmsi`, without that vessel's own minutes, so that its gap is not evidence of poor
 * coverage (R6).
 */
export function coverageAt(
  db: Database,
  lat: number,
  lon: number,
  hourUtc: number,
  opts: CoverageOptions & { excludeMmsi?: number } = {},
): CellCoverage | null {
  const grid = opts.grid ?? DEFAULT_GRID;
  const cell = grid.cellId(lat, lon);
  if (cell === null) return null;
  const row = db
    .query<Tally & { window_start: number; window_end: number }, [number, number]>(
      `SELECT expected_min AS expected, received_min AS received, window_start, window_end
       FROM coverage WHERE cell_id = ? AND hour_utc = ?`,
    )
    .get(cell, hourUtc);
  let expected = row?.expected ?? 0;
  let received = row?.received ?? 0;
  if (row !== null && opts.excludeMmsi !== undefined) {
    const own = windowTallies(db, row.window_start, row.window_end, grid, opts.excludeMmsi).get(cell * 24 + hourUtc);
    expected -= own?.expected ?? 0;
    received -= own?.received ?? 0;
  }
  return {
    cell_id: cell,
    hour_utc: hourUtc,
    expected_min: expected,
    received_min: received,
    ratio: expected > 0 ? received / expected : null,
    sample_ok: expected >= SAMPLE_MIN,
  };
}
