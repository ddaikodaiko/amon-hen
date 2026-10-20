// Synthetic tracks with known gaps (T013). Each vessel sails a straight line at 12 knots, or lies
// still, and goes silent where its case says. The messages go through ingestRaw, so vessels,
// positions and ingest health come out as the live ingest writes them.
import type { Database } from "../../../src/db";
import type { Port } from "../../../src/geo/polygons";
import { closeMinutes } from "../../../src/ingest/health";
import { ingestRaw } from "../../../src/ingest/pipeline";

const MIN = 60_000;
export const T0 = Date.UTC(2026, 9, 19, 6, 0, 0);
export const END = T0 + 450 * MIN;
/** Minutes after T0 when nothing at all arrives: an outage of our own ingest. */
export const OUTAGE: [number, number] = [20, 35];

/** A square over Vuosaari harbour. The anchorage off Kotka is outside every berth. */
export const PORTS: Port[] = [
  {
    name: "Vuosaari",
    polygons: [
      [
        [
          [25.17, 60.2],
          [25.21, 60.2],
          [25.21, 60.23],
          [25.17, 60.23],
          [25.17, 60.2],
        ],
      ],
    ],
  },
];

export type Expected = { state: "pending"; open?: true } | { state: "discarded"; reason: string } | null;

interface Motion {
  lat: number;
  lon: number;
  /** Degrees; null when lying still. */
  cog: number | null;
  knots: number;
  navStat: number;
}

export interface Case {
  name: string;
  mmsi: number;
  cls: "A" | "B";
  motion: Motion;
  /** [from, to) minutes after T0 without messages from this vessel; `to` past END means it never comes back. */
  silent: [number, number];
  expected: Expected;
}

const east = (lane: number): Motion => ({ lat: 59.7 + lane * 0.03, lon: 23.5, cog: 90, knots: 12, navStat: 0 });

export const CASES: Case[] = [
  { name: "A, 45 min at sea", mmsi: 230000101, cls: "A", motion: east(0), silent: [100, 145], expected: { state: "pending" } },
  { name: "A, 20 min", mmsi: 230000102, cls: "A", motion: east(1), silent: [100, 120], expected: null },
  { name: "B, 45 min", mmsi: 230000103, cls: "B", motion: east(2), silent: [100, 145], expected: null },
  { name: "B, 70 min", mmsi: 230000104, cls: "B", motion: east(3), silent: [100, 170], expected: { state: "pending" } },
  {
    name: "overlaps our outage",
    mmsi: 230000105,
    cls: "A",
    motion: east(4),
    silent: [10, 55],
    expected: { state: "discarded", reason: "own_outage" },
  },
  {
    // Crosses lon 22.5 at minute 60; positions outside the region are not stored.
    name: "leaves by the west edge",
    mmsi: 230000106,
    cls: "A",
    motion: { lat: 59.7, lon: 22.9, cog: 270, knots: 12, navStat: 0 },
    silent: [9999, 9999],
    expected: { state: "discarded", reason: "left_region" },
  },
  {
    name: "starts at a Vuosaari berth",
    mmsi: 230000107,
    cls: "A",
    motion: { lat: 60.214, lon: 25.185, cog: null, knots: 0, navStat: 5 },
    silent: [100, 145],
    expected: { state: "discarded", reason: "berth" },
  },
  {
    name: "at anchor off Kotka",
    mmsi: 230000108,
    cls: "A",
    motion: { lat: 60.38, lon: 26.829, cog: null, knots: 0.1, navStat: 1 },
    silent: [100, 150],
    expected: { state: "pending" },
  },
  { name: "open for 6 h", mmsi: 230000109, cls: "A", motion: east(5), silent: [60, 9999], expected: { state: "pending", open: true } },
];

function positionAt(m: Motion, minutes: number): { lat: number; lon: number } {
  if (m.cog === null) return { lat: m.lat, lon: m.lon };
  const nm = (m.knots * minutes) / 60;
  const c = (m.cog * Math.PI) / 180;
  const lat = m.lat + (nm * Math.cos(c)) / 60;
  return { lat, lon: m.lon + (nm * Math.sin(c)) / (60 * Math.cos((m.lat * Math.PI) / 180)) };
}

export interface Message {
  t: number;
  topic: string;
  data: unknown;
}

function build(): Message[] {
  const out: Message[] = [];
  for (const c of CASES) {
    if (c.cls === "A") {
      // Only class A sends the static report with IMO, ETA and draught.
      out.push({ t: T0, topic: `vessels-v2/${c.mmsi}/metadata`, data: { name: `TEST ${c.mmsi}`, imo: 9000000 + (c.mmsi % 1000), eta: 1, draught: 80, type: 70 } });
    }
    const everyS = c.cls === "A" ? 10 : 30;
    for (let s = 0; s * 1000 < END - T0; s += everyS) {
      const min = s / 60;
      if (min >= c.silent[0] && min < c.silent[1]) continue;
      if (min >= OUTAGE[0] && min < OUTAGE[1]) continue;
      const { lat, lon } = positionAt(c.motion, min);
      out.push({
        t: T0 + s * 1000,
        topic: `vessels-v2/${c.mmsi}/location`,
        data: { lat, lon, sog: c.motion.knots, cog: c.motion.cog ?? 360, heading: c.motion.cog ?? 511, navStat: c.motion.navStat },
      });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

export const MESSAGES: Message[] = build();

/** Feeds the messages received in [from, to) and closes ingest health up to `to`. */
export function play(db: Database, from: number, to: number): void {
  db.transaction(() => {
    for (const m of MESSAGES) if (m.t >= from && m.t < to) ingestRaw(db, m.topic, m.data, m.t);
  })();
  closeMinutes(db, to);
}

export const caseOf = (mmsi: number): Case | undefined => CASES.find((c) => c.mmsi === mmsi);
export const at = (minutes: number) => T0 + minutes * MIN;
