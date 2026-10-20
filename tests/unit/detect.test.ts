import { describe, expect, test } from "bun:test";
import { openDb } from "../../src/db";
import { findGaps } from "../../src/detect/gaps";
import { runDetector } from "../../src/detect/run";
import { at, CASES, caseOf, END, PORTS, play, T0 } from "../fixtures/ais/gaps";

const H = 3_600_000;

interface Row {
  id: number;
  mmsi: number;
  gap_start: number;
  gap_end: number | null;
  state: string;
  discard_reason: string | null;
  trigger_at: number | null;
}

const candidates = (db: ReturnType<typeof openDb>) =>
  db
    .query<Row, []>("SELECT id, mmsi, gap_start, gap_end, state, discard_reason, trigger_at FROM candidates ORDER BY mmsi, gap_start")
    .all();
const one = (db: ReturnType<typeof openDb>, mmsi: number) => candidates(db).filter((c) => c.mmsi === mmsi);

/** What the detector made of each case, in the shape of Case.expected. */
function outcome(rows: Row[], mmsi: number): Record<string, unknown> | null {
  const mine = rows.filter((r) => r.mmsi === mmsi);
  if (mine.length === 0) return null;
  expect(mine).toHaveLength(1);
  const c = mine[0]!;
  if (c.state === "discarded") return { state: c.state, reason: c.discard_reason };
  return c.gap_end === null ? { state: c.state, open: true } : { state: c.state };
}

const detect = (now: number) => (db: ReturnType<typeof openDb>) => runDetector(db, now, { ports: PORTS });

describe("findGaps", () => {
  const fix = (min: number) => ({ ts: T0 + min * 60_000, lat: 59.8, lon: 25, sog: 12, cog: 90, nav_status: 0 });

  test("a silence of exactly the threshold is a gap; one second less is not", () => {
    expect(findGaps([fix(0), fix(30)], 30 * 60_000, at(30))).toHaveLength(1);
    expect(findGaps([fix(0), { ...fix(30), ts: at(30) - 1000 }], 30 * 60_000, at(30))).toHaveLength(0);
  });

  test("the silence after the last fix is an open gap once it reaches the threshold at the horizon", () => {
    expect(findGaps([fix(0)], 30 * 60_000, at(29))).toEqual([]);
    expect(findGaps([fix(0)], 30 * 60_000, at(30))).toEqual([{ start: fix(0), end: null }]);
  });
});

describe("detector on the synthetic tracks", () => {
  test("each case gives the candidate, or the discard reason, it should", () => {
    const db = openDb(":memory:");
    play(db, T0, END);
    detect(END)(db);
    const rows = candidates(db);
    for (const c of CASES) expect({ name: c.name, got: outcome(rows, c.mmsi) }).toEqual({ name: c.name, got: c.expected });
    expect(rows.every((r) => caseOf(r.mmsi) !== undefined)).toBe(true);
  });

  test("a gap starts at the last fix before the silence and ends at the first one after it", () => {
    const db = openDb(":memory:");
    play(db, T0, END);
    detect(END)(db);
    const [c] = one(db, 230000101);
    // Positions are stored every 30 s at most, so the last one before minute 100 is at 99:30.
    expect(c?.gap_start).toBe(at(100) - 30_000);
    expect(c?.gap_end).toBe(at(145));
  });

  test("running every 10 minutes gives the same candidates as running once at the end", () => {
    const once = openDb(":memory:");
    play(once, T0, END);
    detect(END)(once);

    const often = openDb(":memory:");
    for (let t = T0; t < END; ) {
      const next = Math.min(t + 10 * 60_000, END);
      play(often, t, next);
      detect(next)(often);
      t = next;
    }
    const strip = (rows: Row[]) => rows.map(({ id: _id, trigger_at: _t, ...r }) => r);
    expect(strip(candidates(often))).toEqual(strip(candidates(once)));
  });

  test("running twice changes nothing", () => {
    const db = openDb(":memory:");
    play(db, T0, END);
    detect(END)(db);
    const first = candidates(db);
    detect(END)(db);
    expect(candidates(db)).toEqual(first);
  });
});

describe("when the investigation is triggered", () => {
  test("a gap waits while the vessel is silent and is triggered when it reappears", () => {
    const db = openDb(":memory:");
    play(db, T0, at(140));
    detect(at(140))(db);
    expect(one(db, 230000101)).toMatchObject([{ state: "detected", gap_end: null, trigger_at: null }]);

    play(db, at(140), at(150));
    detect(at(150))(db);
    expect(one(db, 230000101)).toMatchObject([{ state: "pending", gap_end: at(145), trigger_at: at(150) }]);
  });

  test("a gap still open is triggered when it reaches 6 h, not before", () => {
    const db = openDb(":memory:");
    const start = at(60) - 30_000;
    const before = start + 6 * H - 60_000 - 30_000; // a whole minute less, as health closes by minutes
    play(db, T0, before);
    detect(before)(db);
    expect(one(db, 230000109)).toMatchObject([{ state: "detected", gap_start: start, gap_end: null }]);

    play(db, before, start + 6 * H + 30_000);
    detect(start + 6 * H + 30_000)(db);
    expect(one(db, 230000109)).toMatchObject([{ state: "pending", gap_end: null }]);
  });

  test("the detector looks only as far as ingest health is closed", () => {
    // If the ingest stops, every vessel looks silent; those minutes are not known yet.
    const db = openDb(":memory:");
    play(db, T0, at(200));
    detect(at(200) + 24 * H)(db);
    const rows = candidates(db);
    expect(rows.find((r) => r.mmsi === 230000109)).toMatchObject({ state: "detected", gap_end: null });
    expect(rows.filter((r) => r.state === "pending").map((r) => r.mmsi)).toEqual([230000101, 230000104, 230000108]);
  });

  test("with no ingest health at all, nothing is detected", () => {
    const db = openDb(":memory:");
    expect(detect(END)(db)).toEqual({ created: 0, discarded: 0, triggered: 0, reopened: 0 });
  });
});
