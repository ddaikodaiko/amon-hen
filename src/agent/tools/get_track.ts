import { z } from "zod";
import type { Fix } from "../../detect/gaps";
import { bearingDeg, distanceNm, impliedKnots } from "../../geo/haversine";
import { defineTool, hhmm, instantInput, iso, mmsiInput, round, ToolError } from "./tool";

const MAX_WINDOW_MS = 6 * 3_600_000;
const MAX_POINTS = 120;
/** Faster than this between two consecutive fixes is not one vessel moving (R8, contracts/agent-tools.md). */
export const CONFLICT_KNOTS = 50;
/** Silences this long or longer are listed, and their two ends always kept among the points. */
const SILENCE_MS = 5 * 60_000;

/** Up to `max` indexes: the ends of every silence first, then evenly spread ones. */
function pick(fixes: readonly Fix[], max: number): number[] {
  if (fixes.length <= max) return fixes.map((_, i) => i);
  const keep = new Set<number>([0, fixes.length - 1]);
  for (let i = 1; i < fixes.length; i++) {
    if (fixes[i]!.ts - fixes[i - 1]!.ts >= SILENCE_MS) keep.add(i - 1).add(i);
  }
  if (keep.size > max) return Array.from({ length: max }, (_, k) => Math.round((k * (fixes.length - 1)) / (max - 1)));
  // Spread over the indexes not kept yet, so that none is picked twice.
  const rest = fixes.map((_, i) => i).filter((i) => !keep.has(i));
  const free = max - keep.size;
  for (let k = 0; k < free; k++) keep.add(rest[Math.floor(((k + 0.5) * rest.length) / free)]!);
  return [...keep].sort((a, b) => a - b);
}

const compass = (deg: number) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8]!;

export const getTrack = defineTool({
  name: "get_track",
  description:
    "Positions a vessel reported between two times (6 h at most), up to 120 points, with its average speed, " +
    "dominant course and distance covered, the silences of 5 min or more, and identity_conflicts: consecutive " +
    `positions that would need more than ${CONFLICT_KNOTS} knots (a duplicated or spoofed MMSI, or GNSS interference).`,
  input: z.object({ mmsi: mmsiInput, from: instantInput, to: instantInput }),
  run({ mmsi, from, to }, { db }) {
    if (to <= from) throw new ToolError("`to` must be after `from`");
    if (to - from > MAX_WINDOW_MS) throw new ToolError("the window is 6 h at most; ask for the part around the gap");
    // The briefing gives times to the second and fixes keep their milliseconds: `to` takes in its
    // whole second, or the gap asked for as the briefing states it would lose the fix that ends it.
    const until = Math.floor(to / 1000) * 1000 + 999;
    const fixes = db
      .query<Fix, [number, number, number]>(
        "SELECT ts, lat, lon, sog, cog, nav_status FROM positions WHERE mmsi = ? AND ts >= ? AND ts <= ? ORDER BY ts",
      )
      .all(mmsi, from, until);
    if (fixes.length === 0) {
      return { summary: `No positions from ${mmsi} between ${hhmm(from)} and ${hhmm(to)} UTC.`, data: { points: [], positions: 0 } };
    }

    let distance = 0;
    const silences: { from: string; to: string; minutes: number }[] = [];
    const conflicts: { from: string; to: string; distance_nm: number; implied_knots: number }[] = [];
    const legs = new Map<string, number>();
    for (let i = 1; i < fixes.length; i++) {
      const a = fixes[i - 1]!;
      const b = fixes[i]!;
      const d = distanceNm(a, b);
      const kn = impliedKnots(a, b, b.ts - a.ts);
      if (b.ts - a.ts >= SILENCE_MS) silences.push({ from: iso(a.ts), to: iso(b.ts), minutes: Math.round((b.ts - a.ts) / 60_000) });
      if (kn > CONFLICT_KNOTS) {
        conflicts.push({ from: iso(a.ts), to: iso(b.ts), distance_nm: round(d, 1), implied_knots: Math.round(kn) });
        continue;
      }
      distance += d;
      if (d > 0.01) legs.set(compass(bearingDeg(a, b)), (legs.get(compass(bearingDeg(a, b))) ?? 0) + d);
    }
    const hours = (fixes.at(-1)!.ts - fixes[0]!.ts) / 3_600_000;
    const avgKnots = hours > 0 ? round(distance / hours, 1) : 0;
    const course = [...legs].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
    const points = pick(fixes, MAX_POINTS).map((i) => {
      const f = fixes[i]!;
      return { t: iso(f.ts), lat: round(f.lat, 5), lon: round(f.lon, 5), sog: f.sog, cog: f.cog, nav_status: f.nav_status };
    });

    const parts = [
      `${fixes.length} positions from ${hhmm(fixes[0]!.ts)} to ${hhmm(fixes.at(-1)!.ts)} UTC`,
      `${round(distance, 1)} nm at ${avgKnots} kn on average${course === null ? "" : `, mostly ${course}`}`,
      silences.length === 0
        ? "no silence of 5 min or more"
        : `${silences.length} silence${silences.length > 1 ? "s" : ""}, the longest ${Math.max(...silences.map((s) => s.minutes))} min`,
    ];
    if (conflicts.length > 0) parts.push(`${conflicts.length} identity conflict${conflicts.length > 1 ? "s" : ""} (jumps over ${CONFLICT_KNOTS} kn)`);
    return {
      summary: `${parts.join("; ")}.`,
      data: {
        positions: fixes.length,
        distance_nm: round(distance, 1),
        avg_knots: avgKnots,
        dominant_course: course,
        silences,
        identity_conflicts: conflicts,
        points,
      },
    };
  },
});
