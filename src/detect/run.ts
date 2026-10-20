import portsJson from "../../data/ports.geojson" with { type: "json" };
import { REGION, type Region, THRESHOLDS } from "../config";
import { type Database, getMeta, setMeta } from "../db";
import { loadPorts, type Port } from "../geo/polygons";
import { healthClosedUntil } from "../ingest/health";
import type { AisClass } from "../ingest/parse";
import { type Outage, overlapsOutage, startExclusion } from "./exclusions";
import { type Fix, findGaps, type Gap, thresholdFor } from "./gaps";

// Turns silences into candidates and moves them along: detected → discarded | pending
// (data-model.md, "Estados de un candidato").
//
// It looks only as far as our own ingest health is closed. If the ingest stops, every vessel
// looks silent; once the ingest is back it closes those minutes as an outage, and the gaps
// that overlap it are discarded instead of becoming candidates.

const DEFAULT_PORTS = loadPorts(portsJson);
const SCANNED_UNTIL = "detect_scanned_until";

export interface DetectorOptions {
  ports?: Port[];
  region?: Region;
}

export interface DetectorRun {
  created: number;
  discarded: number;
  triggered: number;
}

interface Waiting {
  id: number;
  gap_start: number;
  gap_end: number | null;
}

export function runDetector(db: Database, now: number, opts: DetectorOptions = {}): DetectorRun {
  const run: DetectorRun = { created: 0, discarded: 0, triggered: 0 };
  const closed = healthClosedUntil(db);
  if (closed === null) return run;
  const horizon = Math.min(now, closed);
  const ports = opts.ports ?? DEFAULT_PORTS;
  const region = opts.region ?? REGION;
  const scanned = Number(getMeta(db, SCANNED_UNTIL) ?? 0);

  const vessels = db.query<{ mmsi: number; ais_class: AisClass }, []>("SELECT mmsi, ais_class FROM vessels");
  // Half-open [scanned, horizon): the minute that starts at the horizon is still open, and a fix
  // stored in it later must not count as already scanned.
  const lastBefore = db.query<Fix, [number, number]>(
    "SELECT ts, lat, lon, sog, cog, nav_status FROM positions WHERE mmsi = ? AND ts < ? ORDER BY ts DESC LIMIT 1",
  );
  const between = db.query<Fix, [number, number, number]>(
    "SELECT ts, lat, lon, sog, cog, nav_status FROM positions WHERE mmsi = ? AND ts >= ? AND ts < ? ORDER BY ts",
  );
  const existing = db.query<{ id: number; gap_end: number | null }, [number, number]>(
    "SELECT id, gap_end FROM candidates WHERE mmsi = ? AND gap_start = ?",
  );
  const insert = db.query(
    `INSERT INTO candidates (mmsi, gap_start, gap_end, start_lat, start_lon, end_lat, end_lon, ais_class,
       nav_status_start, state, discard_reason, created_at)
     VALUES ($mmsi, $gap_start, $gap_end, $start_lat, $start_lon, $end_lat, $end_lon, $ais_class,
       $nav_status_start, $state, $discard_reason, $now)`,
  );
  // The vessel came back: whatever the state, the candidate gets its end.
  const close = db.query("UPDATE candidates SET gap_end = ?, end_lat = ?, end_lon = ? WHERE id = ?");

  function record(mmsi: number, cls: AisClass, gap: Gap): void {
    const found = existing.get(mmsi, gap.start.ts);
    if (found !== null) {
      if (found.gap_end === null && gap.end !== null) close.run(gap.end.ts, gap.end.lat, gap.end.lon, found.id);
      return;
    }
    const reason = startExclusion(gap.start, ports, region);
    insert.run({
      mmsi,
      gap_start: gap.start.ts,
      gap_end: gap.end?.ts ?? null,
      start_lat: gap.start.lat,
      start_lon: gap.start.lon,
      end_lat: gap.end?.lat ?? null,
      end_lon: gap.end?.lon ?? null,
      ais_class: cls,
      nav_status_start: gap.start.nav_status,
      state: reason === null ? "detected" : "discarded",
      discard_reason: reason,
      now,
    });
    run.created++;
    if (reason !== null) run.discarded++;
  }

  db.transaction(() => {
    // Each vessel's last fix already scanned, then the new ones: no pair of fixes is missed.
    for (const { mmsi, ais_class } of vessels.all()) {
      const prev = lastBefore.get(mmsi, scanned);
      const fixes = [...(prev === null ? [] : [prev]), ...between.all(mmsi, scanned, horizon)];
      for (const gap of findGaps(fixes, thresholdFor(ais_class), horizon)) record(mmsi, ais_class, gap);
    }

    const outages = db.query<Outage, []>("SELECT start_ts, end_ts FROM outages").all();
    const waiting = db.query<Waiting, []>("SELECT id, gap_start, gap_end FROM candidates WHERE state = 'detected'").all();
    const discard = db.query("UPDATE candidates SET state = 'discarded', discard_reason = 'own_outage' WHERE id = ?");
    const trigger = db.query("UPDATE candidates SET state = 'pending', trigger_at = ? WHERE id = ?");
    for (const c of waiting) {
      if (overlapsOutage(outages, c.gap_start, c.gap_end ?? horizon)) {
        discard.run(c.id);
        run.discarded++;
      } else if (c.gap_end !== null || horizon - c.gap_start >= THRESHOLDS.triggerMs) {
        trigger.run(now, c.id);
        run.triggered++;
      }
    }

    setMeta(db, SCANNED_UNTIL, String(Math.max(scanned, horizon)));
  })();
  return run;
}
