import { getNearby } from "../agent/tools/get_nearby";
import { iso } from "../agent/tools/tool";
import { coverageAt } from "../coverage/compute";
import type { Database } from "../db";
import { distanceNm, impliedKnots } from "../geo/haversine";
import { nearestPlace } from "../geo/places";
import type * as Api from "../shared/api";

// What the data says about a gap without the agent, for people: where it was, whether the vessel
// moved while silent, how well that spot is heard, what the vessels around it did and how often
// this vessel goes silent. The same facts the agent's tools look at, so the panel can show them
// before any investigation. Nothing here comes from a dossier: the labelling view uses it too.

/** How much of the track is shown around a gap. */
export const CASE_TRACK = { beforeMs: 3 * 3_600_000, afterMs: 2 * 3_600_000 } as const;
const NEARBY_RADIUS_NM = 10;
const MAX_OTHER = 10;
const KM_PER_NM = 1.852;

interface GapRow {
  id: number;
  mmsi: number;
  gap_start: number;
  gap_end: number | null;
  start_lat: number;
  start_lon: number;
  end_lat: number | null;
  end_lon: number | null;
}

const round = (x: number, digits: number) => Math.round(x * 10 ** digits) / 10 ** digits;

/** Positions around the gap, oldest first. */
export function gapTrack(db: Database, mmsi: number, gapStart: number, gapEnd: number | null): Api.TrackPoint[] {
  return db
    .query<{ ts: number; lat: number; lon: number }, [number, number, number]>(
      "SELECT ts, lat, lon FROM positions WHERE mmsi = ? AND ts >= ? AND ts <= ? ORDER BY ts",
    )
    .all(mmsi, gapStart - CASE_TRACK.beforeMs, (gapEnd ?? gapStart) + CASE_TRACK.afterMs)
    .map((p): Api.TrackPoint => [p.ts, round(p.lat, 5), round(p.lon, 5)]);
}

export async function caseContext(db: Database, id: number): Promise<Api.CaseContext> {
  const c = db
    .query<GapRow, [number]>(
      "SELECT id, mmsi, gap_start, gap_end, start_lat, start_lon, end_lat, end_lon FROM candidates WHERE id = ?",
    )
    .get(id)!;
  const start = { lat: c.start_lat, lon: c.start_lon };
  const end = c.end_lat === null || c.end_lon === null ? null : { lat: c.end_lat, lon: c.end_lon };
  const moved = end === null || c.gap_end === null ? null : { km: distanceNm(start, end) * KM_PER_NM, kn: impliedKnots(start, end, c.gap_end - c.gap_start) };

  const before = db
    .query<{ sog: number | null }, [number, number]>("SELECT sog FROM positions WHERE mmsi = ? AND ts <= ? ORDER BY ts DESC LIMIT 1")
    .get(c.mmsi, c.gap_start);

  // Without the vessel's own minutes, so its silence does not count against the spot (R6).
  const cov = coverageAt(db, start.lat, start.lon, new Date(c.gap_start).getUTCHours(), { excludeMmsi: c.mmsi });

  // The first hour of the silence at most, as the agent would usually look at it.
  const silentMin = c.gap_end === null ? 60 : Math.min(60, (c.gap_end - c.gap_start) / 60_000);
  const half = Math.max(5, Math.round(silentMin / 2));
  const nearby = await getNearby.run(
    getNearby.input.parse({ lat: start.lat, lon: start.lon, at: iso(c.gap_start + half * 60_000), radius_nm: NEARBY_RADIUS_NM, window_min: half }),
    { db, mmsi: c.mmsi, citable: new Set() },
  );
  const n = nearby.data as { reporting_count: number; silent_count: number };

  // Our own outages are not the vessel's silences.
  const others = `FROM candidates WHERE mmsi = ? AND id != ? AND coalesce(discard_reason, '') != 'own_outage'`;
  const other = db
    .query<{ id: number; gap_start: number; gap_end: number | null }, [number, number, number]>(
      `SELECT id, gap_start, gap_end ${others} ORDER BY gap_start DESC LIMIT ?`,
    )
    .all(c.mmsi, c.id, MAX_OTHER);
  const otherTotal = db.query<{ n: number }, [number, number]>(`SELECT count(*) AS n ${others}`).get(c.mmsi, c.id)!.n;

  return {
    near_start: nearestPlace(start.lat, start.lon),
    near_end: end === null ? null : nearestPlace(end.lat, end.lon),
    moved_km: moved === null ? null : round(moved.km, 1),
    implied_kn: moved === null ? null : round(moved.kn, 1),
    speed_before_kn: before?.sog ?? null,
    coverage:
      cov === null ? null : { ratio: cov.ratio === null ? null : round(cov.ratio, 2), expected_min: cov.expected_min, enough_data: cov.sample_ok },
    nearby: { total: n.reporting_count + n.silent_count, kept_reporting: n.reporting_count, radius_km: Math.round(NEARBY_RADIUS_NM * KM_PER_NM) },
    other_silences: other.map((o) => ({
      id: o.id,
      gap_start: o.gap_start,
      duration_min: o.gap_end === null ? null : Math.round((o.gap_end - o.gap_start) / 60_000),
    })),
    other_silences_total: otherTotal,
    track: gapTrack(db, c.mmsi, c.gap_start, c.gap_end),
  };
}
