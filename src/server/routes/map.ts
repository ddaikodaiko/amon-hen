import { z } from "zod";
import { SAMPLE_MIN } from "../../coverage/compute";
import type { Database } from "../../db";
import { flagOf } from "../../geo/mid";
import { CELL_DEG, Grid } from "../../geo/grid";
import { shipTypeLabel } from "../../geo/ship-type";
import type * as Api from "../../shared/api";
import { HttpError, type Route } from "../http";
import { parse } from "./parse";

// What the map draws besides the stream: the coverage layer and the selected vessel.

export const TRACK_HOURS = { default: 6, max: 24 } as const;

export function vesselInfo(db: Database, mmsi: number): Api.VesselInfo | null {
  const v = db
    .query<
      { name: string | null; callsign: string | null; imo: number | null; ship_type: number | null; length_m: number | null; ais_class: "A" | "B"; destination: string | null },
      [number]
    >("SELECT name, callsign, imo, ship_type, length_m, ais_class, destination FROM vessels WHERE mmsi = ?")
    .get(mmsi);
  if (v === null) return null;
  return {
    name: v.name,
    flag: flagOf(mmsi),
    type_label: shipTypeLabel(v.ship_type),
    callsign: v.callsign,
    imo: v.imo,
    length_m: v.length_m,
    ais_class: v.ais_class,
    destination: v.destination,
  };
}

const CoverageQuery = z.object({
  hour: z.coerce.number().int().min(0).max(23).default(() => new Date().getUTCHours()),
});

const coverage: Route = {
  method: "GET",
  path: "/api/coverage",
  handler: ({ url, app }) => {
    const { hour } = parse(CoverageQuery, Object.fromEntries(url.searchParams), "query");
    const grid = new Grid();
    const rows = app.db
      .query<{ cell_id: number; expected_min: number; received_min: number; window_start: number; window_end: number }, [number]>(
        "SELECT cell_id, expected_min, received_min, window_start, window_end FROM coverage WHERE hour_utc = ? AND expected_min > 0",
      )
      .all(hour);
    const body: Api.CoverageLayer = {
      hour,
      window: rows[0] === undefined ? null : { start: rows[0].window_start, end: rows[0].window_end },
      cell_deg: CELL_DEG,
      sample_min: SAMPLE_MIN,
      cells: rows.map((r) => {
        const b = grid.cellBounds(r.cell_id);
        return [b.latMin, b.lonMin, Math.round((r.received_min / r.expected_min) * 1000) / 1000, r.expected_min];
      }),
    };
    return Response.json(body);
  },
};

const VesselQuery = z.object({
  at: z.coerce.number().int().positive().optional(),
  hours: z.coerce.number().min(0.5).max(TRACK_HOURS.max).default(TRACK_HOURS.default),
});

const vessel: Route = {
  method: "GET",
  path: "/api/vessels/:mmsi",
  handler: ({ url, params, app }) => {
    const mmsi = parse(z.coerce.number().int().min(100_000_000).max(999_999_999), params.mmsi, "MMSI");
    const q = parse(VesselQuery, Object.fromEntries(url.searchParams), "query");
    const info = vesselInfo(app.db, mmsi);
    if (info === null) throw new HttpError(404, "not_found", `vessel ${mmsi} is not in the database`);
    const at = q.at ?? Date.now();
    const track = app.db
      .query<{ ts: number; lat: number; lon: number }, [number, number, number]>(
        "SELECT ts, lat, lon FROM positions WHERE mmsi = ? AND ts > ? AND ts <= ? ORDER BY ts",
      )
      .all(mmsi, at - q.hours * 3_600_000, at)
      .map((p): Api.TrackPoint => [p.ts, Math.round(p.lat * 1e5) / 1e5, Math.round(p.lon * 1e5) / 1e5]);
    const body: Api.VesselDetail = { mmsi, ...info, track };
    return Response.json(body);
  },
};

/** The land polygons of the base map (T039). The map draws without them while they are missing. */
export const LAND_FILE = new URL("../../../data/land.geojson", import.meta.url).pathname;

const land: Route = {
  method: "GET",
  path: "/api/land",
  handler: async () => {
    const file = Bun.file(LAND_FILE);
    if (!(await file.exists())) throw new HttpError(404, "not_found", "data/land.geojson is not there yet (T039)");
    return new Response(file, { headers: { "content-type": "application/geo+json", "cache-control": "max-age=86400" } });
  },
};

export const MAP_ROUTES: Route[] = [coverage, vessel, land];
