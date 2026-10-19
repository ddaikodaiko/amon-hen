import { describe, expect, test } from "bun:test";
import { openDb } from "../../src/db";
import { closeMinutes } from "../../src/ingest/health";
import { applyEvent, ingestRaw } from "../../src/ingest/pipeline";

const T0 = Date.UTC(2026, 9, 19, 12, 0, 0);
const MIN = 60_000;

const location = (mmsi: number, lat = 60.05, lon = 24.95) => ({
  topic: `vessels-v2/${mmsi}/location`,
  data: { lat, lon, sog: 12, cog: 90, heading: 90, navStat: 0 },
});
const metadata = (mmsi: number) => ({
  topic: `vessels-v2/${mmsi}/metadata`,
  data: { name: "TESTER", imo: 9385831, eta: 734336, draught: 80, type: 80, refA: 100, refB: 20, refC: 10, refD: 10 },
});

function feed(db: ReturnType<typeof openDb>, msg: { topic: string; data: unknown }, ts: number) {
  return ingestRaw(db, msg.topic, msg.data, ts);
}

/** One message at the start of each of these minutes after T0. */
function minutesWithMessages(db: ReturnType<typeof openDb>, minutes: number[]) {
  for (const m of minutes) feed(db, location(230000001), T0 + m * MIN);
}

const outages = (db: ReturnType<typeof openDb>) =>
  db.query<{ start_ts: number; end_ts: number | null; cause: string }, []>(
    "SELECT start_ts, end_ts, cause FROM outages ORDER BY id",
  ).all();

describe("positions", () => {
  test("keeps at most one position every 30 s per vessel", () => {
    const db = openDb(":memory:");
    for (let s = 0; s <= 120; s += 10) feed(db, location(230000001), T0 + s * 1000);
    feed(db, location(230000002), T0 + 5_000);
    const ts = db
      .query<{ ts: number }, []>("SELECT ts FROM positions WHERE mmsi = 230000001 ORDER BY ts")
      .all()
      .map((r) => (r.ts - T0) / 1000);
    expect(ts).toEqual([0, 30, 60, 90, 120]);
    expect(db.query("SELECT 1 FROM positions WHERE mmsi = 230000002").all()).toHaveLength(1);
  });

  test("positions outside the region are not stored", () => {
    const db = openDb(":memory:");
    expect(feed(db, location(230000001, 57.0, 20.0), T0)).toBe(false);
    expect(db.query("SELECT 1 FROM positions").all()).toHaveLength(0);
  });

  test("a vessel seen first by position is class B until its static data says A", () => {
    const db = openDb(":memory:");
    feed(db, location(667002320), T0);
    const cls = () => db.query<{ ais_class: string; flag_mid: number }, []>("SELECT ais_class, flag_mid FROM vessels").get();
    expect(cls()).toEqual({ ais_class: "B", flag_mid: 667 });
    feed(db, metadata(667002320), T0 + 1000);
    expect(cls()?.ais_class).toBe("A");
  });

  test("invalid messages count for health but store nothing", () => {
    const db = openDb(":memory:");
    expect(ingestRaw(db, "vessels-v2/123/location", { lat: 60, lon: 25 }, T0)).toBe(false);
    expect(db.query<{ msg_count: number }, []>("SELECT msg_count FROM ingest_minutes").get()?.msg_count).toBe(1);
  });
});

describe("health", () => {
  test("a 3-minute silence is an outage, from its first silent minute to the next message", () => {
    const db = openDb(":memory:");
    minutesWithMessages(db, [0, 1, 5, 6]);
    closeMinutes(db, T0 + 7 * MIN);
    expect(outages(db)).toEqual([{ start_ts: T0 + 2 * MIN, end_ts: T0 + 5 * MIN, cause: "no_messages" }]);
  });

  test("one minute without messages is not an outage", () => {
    const db = openDb(":memory:");
    minutesWithMessages(db, [0, 1, 3, 4]);
    closeMinutes(db, T0 + 5 * MIN);
    expect(outages(db)).toEqual([]);
  });

  test("closing minute by minute gives the same result, and closing twice changes nothing", () => {
    const db = openDb(":memory:");
    for (const m of [0, 1, 2, 3, 4, 5, 6]) {
      if (![2, 3, 4].includes(m)) minutesWithMessages(db, [m]);
      closeMinutes(db, T0 + (m + 1) * MIN);
    }
    closeMinutes(db, T0 + 7 * MIN);
    expect(outages(db)).toEqual([{ start_ts: T0 + 2 * MIN, end_ts: T0 + 5 * MIN, cause: "no_messages" }]);
  });

  test("an outage still going on has no end", () => {
    const db = openDb(":memory:");
    minutesWithMessages(db, [0]);
    closeMinutes(db, T0 + 10 * MIN);
    expect(outages(db)).toEqual([{ start_ts: T0 + MIN, end_ts: null, cause: "no_messages" }]);
  });

  test("a dropped connection counts as down even if the minute had messages", () => {
    const db = openDb(":memory:");
    minutesWithMessages(db, [0, 1]);
    applyEvent(db, { kind: "close", ts: T0 + MIN + 30_000 });
    applyEvent(db, { kind: "open", ts: T0 + 3 * MIN + 10_000 });
    minutesWithMessages(db, [3.5, 4]);
    closeMinutes(db, T0 + 5 * MIN);
    expect(outages(db)).toEqual([{ start_ts: T0 + MIN, end_ts: T0 + 3 * MIN, cause: "disconnected" }]);
  });

  test("hours with the process stopped are one outage", () => {
    const db = openDb(":memory:");
    minutesWithMessages(db, [0, 180]);
    closeMinutes(db, T0 + 181 * MIN);
    expect(outages(db)).toEqual([{ start_ts: T0 + MIN, end_ts: T0 + 180 * MIN, cause: "no_messages" }]);
    expect(db.query("SELECT 1 FROM ingest_minutes").all()).toHaveLength(181);
  });
});
