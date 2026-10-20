import type { Database } from "../db";
import type { VesselTick } from "../shared/api";

// The replay clock (FR-025): data time runs `speed` times faster than the wall clock over the
// recorded range, and starts over at the end. Each viewer has their own: a speed change
// re-anchors it at the current data time, so the clock never jumps.

export const SPEEDS = [1, 10, 60, 300] as const;
export type Speed = (typeof SPEEDS)[number];

export interface Range {
  start: number;
  end: number;
}

export class ReplayClock {
  private anchorData: number;
  private anchorWall: number;

  constructor(
    readonly range: Range,
    private rate: Speed = 60,
    at: number = range.start,
    private readonly wall: () => number = Date.now,
  ) {
    if (range.end <= range.start) throw new Error("the replay range is empty");
    this.anchorData = Math.min(Math.max(at, range.start), range.end);
    this.anchorWall = wall();
  }

  get speed(): Speed {
    return this.rate;
  }

  /** The data time now. */
  now(): number {
    const run = this.anchorData - this.range.start + (this.wall() - this.anchorWall) * this.rate;
    return this.range.start + (run % (this.range.end - this.range.start));
  }

  setSpeed(speed: Speed): void {
    const t = this.now();
    this.anchorData = t;
    this.anchorWall = this.wall();
    this.rate = speed;
  }
}

/** The time span of the recording in a database, or null if it has no positions. */
export function recordedRange(db: Database): Range | null {
  const r = db.query<{ start: number | null; end: number | null }, []>("SELECT min(ts) AS start, max(ts) AS end FROM positions").get();
  return r?.start == null || r.end == null || r.end <= r.start ? null : { start: r.start, end: r.end };
}

/** A vessel not heard from in this long leaves the map; its gap mark stays. */
export const STALE_MS = 10 * 60_000;

/** The last position of each vessel heard from in the STALE_MS before `t`, compact: it goes out every second. */
export function positionsAt(db: Database, t: number): VesselTick[] {
  // SQLite returns the other columns of the row that has the max(ts).
  return db
    .query<{ mmsi: number; lat: number; lon: number; sog: number | null; cog: number | null }, [number, number]>(
      "SELECT mmsi, lat, lon, sog, cog, max(ts) FROM positions WHERE ts > ? AND ts <= ? GROUP BY mmsi",
    )
    .all(t - STALE_MS, t)
    .map((p) => [p.mmsi, Math.round(p.lat * 1e5) / 1e5, Math.round(p.lon * 1e5) / 1e5, p.sog, p.cog]);
}
