import { z } from "zod";
import type { Fix } from "../../detect/gaps";
import { distanceNm, impliedKnots } from "../../geo/haversine";
import { CONFLICT_KNOTS } from "./get_track";
import { defineTool, hhmm, instantInput, latInput, lonInput, round } from "./tool";

/** A neighbour that goes this long without a position, inside the window, did not keep reporting. */
const SILENT_MS = 10 * 60_000;
const MAX_LISTED = 30;

export const getNearby = defineTool({
  name: "get_nearby",
  description:
    "Other vessels within radius_nm of a point at some time in [at - window_min, at + window_min], and whether " +
    "each kept reporting through that window (no silence of 10 min or more). Many silent neighbours point to a " +
    "reception problem; neighbours that kept reporting point to the vessel itself. jumping_count is how many " +
    `made impossible position jumps (over ${CONFLICT_KNOTS} knots), the sign of GNSS interference.`,
  input: z.object({
    lat: latInput,
    lon: lonInput,
    at: instantInput,
    radius_nm: z.number().min(1).max(20).default(10).describe("1 to 20, default 10"),
    window_min: z.number().int().min(5).max(360).default(30).describe("minutes either side of `at`, 5 to 360, default 30"),
  }),
  run({ lat, lon, at, radius_nm, window_min }, { db, mmsi }) {
    const from = at - window_min * 60_000;
    // The window cannot reach past the newest data: the minutes after it are not silent, just not here yet.
    const newest = db.query<{ t: number | null }, []>("SELECT max(ts) AS t FROM positions").get()?.t ?? at;
    const to = Math.min(at + window_min * 60_000, newest);
    const dLat = radius_nm / 60;
    const dLon = radius_nm / (60 * Math.cos((lat * Math.PI) / 180));
    const near = db
      .query<{ mmsi: number }, [number, number, number, number, number, number, number]>(
        `SELECT DISTINCT mmsi FROM positions
         WHERE ts >= ? AND ts <= ? AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? AND mmsi != ?`,
      )
      .all(from, to, lat - dLat, lat + dLat, lon - dLon, lon + dLon, mmsi);
    // Minutes our own ingest was down are nobody's silence, as for the detector. A window that began
    // inside an outage made every neighbour look silent (SC-008, review-sc008.md).
    const outages = db
      .query<{ start_ts: number; end_ts: number | null }, [number, number]>(
        "SELECT start_ts, end_ts FROM outages WHERE start_ts < ? AND (end_ts IS NULL OR end_ts > ?)",
      )
      .all(to, from);
    const down = (a: number, b: number) =>
      outages.reduce((s, o) => s + Math.max(0, Math.min(b, o.end_ts ?? b) - Math.max(a, o.start_ts)), 0);
    const silent = (a: number, b: number) => b - a - down(a, b);
    const track = db.query<Fix, [number, number, number]>(
      "SELECT ts, lat, lon, sog, cog, nav_status FROM positions WHERE mmsi = ? AND ts >= ? AND ts <= ? ORDER BY ts",
    );
    const name = db.query<{ name: string | null }, [number]>("SELECT name FROM vessels WHERE mmsi = ?");

    const vessels: { mmsi: number; name: string | null; distance_nm: number; kept_reporting: boolean; jumps: boolean }[] = [];
    for (const { mmsi: other } of near) {
      const fixes = track.all(other, from, to);
      const closest = Math.min(...fixes.map((f) => distanceNm({ lat, lon }, f)));
      if (fixes.length === 0 || closest > radius_nm) continue;
      let longest = Math.max(silent(from, fixes[0]!.ts), silent(fixes.at(-1)!.ts, to));
      let jumps = false;
      for (let i = 1; i < fixes.length; i++) {
        const a = fixes[i - 1]!;
        const b = fixes[i]!;
        longest = Math.max(longest, silent(a.ts, b.ts));
        if (impliedKnots(a, b, b.ts - a.ts) > CONFLICT_KNOTS) jumps = true;
      }
      vessels.push({
        mmsi: other,
        name: name.get(other)?.name ?? null,
        distance_nm: round(closest, 1),
        kept_reporting: longest < SILENT_MS,
        jumps,
      });
    }
    vessels.sort((a, b) => a.distance_nm - b.distance_nm);
    const reporting = vessels.filter((v) => v.kept_reporting).length;
    const jumping = vessels.filter((v) => v.jumps).length;
    const data = {
      vessels: vessels.slice(0, MAX_LISTED).map(({ jumps: _j, ...v }) => v),
      listed: Math.min(vessels.length, MAX_LISTED),
      silent_count: vessels.length - reporting,
      reporting_count: reporting,
      jumping_count: jumping,
    };
    const downMin = Math.round(down(from, to) / 60_000);
    const where =
      `within ${radius_nm} nm, ${hhmm(from)}-${hhmm(to)} UTC` +
      (downMin > 0 ? ` (our ingest was down ${downMin} min of it, not counted)` : "");
    // With only the counts, a neighbour 0.2 nm away that kept reporting went unremarked in 2 of the
    // 10 dossiers reviewed for SC-008 (review-sc008.md). The list is sorted, so find() is the nearest.
    const nearest = (kept: boolean) => {
      const v = vessels.find((x) => x.kept_reporting === kept);
      return v === undefined ? "" : ` (the closest at ${v.distance_nm} nm)`;
    };
    const summary =
      vessels.length === 0
        ? `No other vessel reported ${where}.`
        : `${vessels.length} other vessel${vessels.length > 1 ? "s" : ""} ${where}: ${reporting} kept reporting${nearest(true)}, ` +
          `${vessels.length - reporting} went silent for 10 min or more${nearest(false)}` +
          (jumping > 0 ? `; ${jumping} made impossible jumps.` : ".");
    return { summary, data };
  },
});
