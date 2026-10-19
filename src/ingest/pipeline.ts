import { REGION, THRESHOLDS } from "../config";
import type { Database } from "../db";
import { midOf } from "../geo/mid";
import { countMessage } from "./health";
import { type ParsedMessage, parseMessage } from "./parse";

export { applyEvent } from "./health";

function inRegion(lat: number, lon: number): boolean {
  return lat >= REGION.lat_min && lat < REGION.lat_max && lon >= REGION.lon_min && lon < REGION.lon_max;
}

/**
 * Applies one parsed message. Static data is kept for every vessel (it arrives rarely and the
 * vessel may enter the region later); positions only inside the region, at most one every 30 s.
 * Returns whether something was stored.
 */
export function applyMessage(db: Database, msg: ParsedMessage): boolean {
  if (msg.kind === "static") {
    db.query(
      `INSERT INTO vessels (mmsi, name, callsign, destination, imo, ship_type, ais_class, length_m, width_m, flag_mid, updated_at)
       VALUES ($mmsi, $name, $callsign, $destination, $imo, $ship_type, $ais_class, $length_m, $width_m, $flag_mid, $ts)
       ON CONFLICT (mmsi) DO UPDATE SET
         name = excluded.name, callsign = excluded.callsign, destination = excluded.destination,
         imo = excluded.imo, ship_type = excluded.ship_type, ais_class = excluded.ais_class,
         length_m = excluded.length_m, width_m = excluded.width_m, updated_at = excluded.updated_at`,
    ).run({
      mmsi: msg.mmsi,
      name: msg.name,
      callsign: msg.callsign,
      destination: msg.destination,
      imo: msg.imo,
      ship_type: msg.ship_type,
      ais_class: msg.ais_class,
      length_m: msg.length_m,
      width_m: msg.width_m,
      flag_mid: midOf(msg.mmsi),
      ts: msg.ts,
    });
    return true;
  }

  if (!inRegion(msg.lat, msg.lon)) return false;
  db.query("INSERT INTO vessels (mmsi, flag_mid, updated_at) VALUES (?, ?, ?) ON CONFLICT (mmsi) DO NOTHING").run(
    msg.mmsi,
    midOf(msg.mmsi),
    msg.ts,
  );
  const last = db
    .query<{ ts: number }, [number]>("SELECT ts FROM positions WHERE mmsi = ? ORDER BY ts DESC LIMIT 1")
    .get(msg.mmsi);
  if (last !== null && msg.ts - last.ts < THRESHOLDS.positionEveryMs) return false;
  db.query(
    `INSERT INTO positions (mmsi, ts, lat, lon, sog, cog, heading, nav_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(msg.mmsi, msg.ts, msg.lat, msg.lon, msg.sog, msg.cog, msg.heading, msg.nav_status);
  return true;
}

/** Everything received counts for health, valid or not; then it is parsed and applied. */
export function ingestRaw(db: Database, topic: string, data: unknown, receivedAt: number): boolean {
  countMessage(db, receivedAt);
  const msg = parseMessage(topic, data, receivedAt);
  return msg !== null && applyMessage(db, msg);
}
