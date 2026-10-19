// Digitraffic messages → typed positions and static data. Formats in research.md, R7.

export type AisClass = "A" | "B";

export interface PositionMsg {
  kind: "position";
  mmsi: number;
  /** Reception time (ms). */
  ts: number;
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  nav_status: number | null;
}

export interface StaticMsg {
  kind: "static";
  mmsi: number;
  ts: number;
  name: string | null;
  callsign: string | null;
  imo: number | null;
  ship_type: number | null;
  length_m: number | null;
  width_m: number | null;
  destination: string | null;
  ais_class: AisClass;
}

export type ParsedMessage = PositionMsg | StaticMsg;

type Data = Record<string, unknown>;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const positive = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
};
const text = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
};
/** Value, or null when it is the AIS "not available" code or out of range. */
const inRange = (v: unknown, min: number, max: number): number | null => {
  const n = num(v);
  return n !== null && n >= min && n <= max ? n : null;
};

/** vessels-v2/<mmsi>/location → mmsi, only for 9-digit MMSIs. */
export function mmsiFromTopic(topic: string): number | null {
  const mmsi = Number(topic.split("/")[1]);
  return Number.isInteger(mmsi) && mmsi >= 100_000_000 && mmsi <= 999_999_999 ? mmsi : null;
}

/**
 * Class A unless proven otherwise is not safe, so it is the other way round: only the class A
 * static report (message 5) carries IMO, ETA and draught. Digitraffic publishes metadata almost
 * only for class A; a vessel with no metadata stays B (the longer, safer threshold).
 */
export function aisClassOf(meta: Data): AisClass {
  return positive(meta.imo) !== null || positive(meta.eta) !== null || positive(meta.draught) !== null ? "A" : "B";
}

export function parseMessage(topic: string, data: unknown, receivedAt: number): ParsedMessage | null {
  const mmsi = mmsiFromTopic(topic);
  if (mmsi === null || typeof data !== "object" || data === null) return null;
  const d = data as Data;

  if (topic.endsWith("/location")) {
    const lat = inRange(d.lat, -90, 90);
    const lon = inRange(d.lon, -180, 180);
    if (lat === null || lon === null || (lat === 0 && lon === 0)) return null;
    const navStatus = inRange(d.navStat, 0, 14);
    return {
      kind: "position",
      mmsi,
      ts: receivedAt,
      lat,
      lon,
      sog: inRange(d.sog, 0, 102.2),
      cog: inRange(d.cog, 0, 359.9),
      heading: inRange(d.heading, 0, 359),
      nav_status: navStatus,
    };
  }

  if (topic.endsWith("/metadata")) {
    const along = (num(d.refA) ?? 0) + (num(d.refB) ?? 0);
    const across = (num(d.refC) ?? 0) + (num(d.refD) ?? 0);
    return {
      kind: "static",
      mmsi,
      ts: receivedAt,
      name: text(d.name),
      callsign: text(d.callSign),
      imo: positive(d.imo),
      ship_type: positive(d.type),
      length_m: along > 0 ? along : null,
      width_m: across > 0 ? across : null,
      destination: text(d.destination),
      ais_class: aisClassOf(d),
    };
  }

  return null;
}
