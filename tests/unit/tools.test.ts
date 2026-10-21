import { describe, expect, test } from "bun:test";
import { runTool, type ToolResult } from "../../src/agent/tools";
import { computeCoverage } from "../../src/coverage/compute";
import { openDb } from "../../src/db";

const T0 = Date.UTC(2026, 9, 19, 12, 0, 0);
const MIN = 60_000;
const iso = (min: number) => new Date(T0 + min * MIN).toISOString();

type Db = ReturnType<typeof openDb>;

function vessel(db: Db, mmsi: number, fields: Partial<Record<"name" | "ship_type" | "ais_class" | "length_m" | "destination" | "imo", unknown>> = {}) {
  db.query(
    `INSERT INTO vessels (mmsi, name, imo, ship_type, ais_class, length_m, destination, flag_mid, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    mmsi,
    (fields.name as string) ?? null,
    (fields.imo as number) ?? null,
    (fields.ship_type as number) ?? null,
    (fields.ais_class as string) ?? "A",
    (fields.length_m as number) ?? null,
    (fields.destination as string) ?? null,
    Math.floor(mmsi / 1e6),
    T0,
  );
}

/** A fix every 30 s for `minutes`, eastbound at `knots` from (lat, lon), skipping [from, to) minutes. */
function sail(db: Db, mmsi: number, lat: number, lon: number, minutes: number, silent: [number, number] | null = null, knots = 12) {
  const insert = db.query("INSERT INTO positions (mmsi, ts, lat, lon, sog, cog, nav_status) VALUES (?, ?, ?, ?, ?, 90, 0)");
  for (let s = 0; s < minutes * 60; s += 30) {
    if (silent !== null && s / 60 >= silent[0] && s / 60 < silent[1]) continue;
    insert.run(mmsi, T0 + s * 1000, lat, lon + (knots * (s / 3600)) / (60 * Math.cos((lat * Math.PI) / 180)), knots);
  }
}

const ctxFor = (db: Db, mmsi = 230000001) => ({ db, mmsi, citable: new Set<number>() });
function ok(r: ToolResult): { summary: string; data: Record<string, unknown> } {
  if (r.isError) throw new Error(`tool failed: ${r.summary}`);
  return { summary: r.summary, data: r.data as Record<string, unknown> };
}

describe("get_track", () => {
  test("a 40 nm jump in 5 minutes is an identity conflict, and does not count as distance", async () => {
    const db = openDb(":memory:");
    vessel(db, 230000001);
    sail(db, 230000001, 59.8, 24.0, 30);
    // 40 nm north, 5 minutes after the last fix.
    db.query("INSERT INTO positions (mmsi, ts, lat, lon, sog, cog, nav_status) VALUES (?, ?, ?, ?, 12, 90, 0)").run(
      230000001,
      T0 + 34.5 * MIN,
      59.8 + 40 / 60,
      24.2,
    );
    const r = ok(await runTool("get_track", { mmsi: 230000001, from: iso(0), to: iso(60) }, ctxFor(db)));
    const conflicts = r.data.identity_conflicts as { distance_nm: number; implied_knots: number }[];
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.implied_knots).toBeGreaterThan(400);
    expect(r.data.distance_nm as number).toBeCloseTo(6, 0);
    expect(r.summary).toContain("1 identity conflict");
  });

  test("at most 120 points, and both ends of a silence are always among them", async () => {
    const db = openDb(":memory:");
    vessel(db, 230000001);
    sail(db, 230000001, 59.8, 24.0, 300, [100, 145]);
    const r = ok(await runTool("get_track", { mmsi: 230000001, from: iso(0), to: iso(300) }, ctxFor(db)));
    const points = (r.data.points as { t: string }[]).map((p) => p.t);
    expect(points).toHaveLength(120);
    expect(points).toContain(new Date(T0 + 99.5 * MIN).toISOString().replace(".000Z", "Z"));
    expect(points).toContain(new Date(T0 + 145 * MIN).toISOString().replace(".000Z", "Z"));
    expect(r.data.silences).toEqual([{ from: "2026-10-19T13:39:30Z", to: "2026-10-19T14:25:00Z", minutes: 46 }]);
    expect(r.data.avg_knots as number).toBeCloseTo(12, 0);
    expect(r.data.dominant_course).toBe("E");
  });

  test("times without an offset are UTC", async () => {
    const db = openDb(":memory:");
    vessel(db, 230000001);
    sail(db, 230000001, 59.8, 24.0, 30);
    const r = ok(await runTool("get_track", { mmsi: 230000001, from: "2026-10-19T12:10:00", to: "2026-10-19T12:20" }, ctxFor(db)));
    expect(r.data.positions).toBe(21);
  });

  test("`to` takes in its whole second: the gap as the briefing states it keeps the fix that ends it", async () => {
    const db = openDb(":memory:");
    vessel(db, 230000001);
    const insert = db.query("INSERT INTO positions (mmsi, ts, lat, lon, sog, cog, nav_status) VALUES (?, ?, 59.9, 30.2, 0, NULL, 5)");
    insert.run(230000001, T0 + 522);
    insert.run(230000001, T0 + 36 * MIN + 858);
    const r = ok(await runTool("get_track", { mmsi: 230000001, from: "2026-10-19T12:00:00Z", to: "2026-10-19T12:36:00Z" }, ctxFor(db)));
    expect(r.data.positions).toBe(2);
    expect(r.data.silences).toEqual([{ from: "2026-10-19T12:00:00.522Z", to: "2026-10-19T12:36:00.858Z", minutes: 36 }]);
  });

  test("more than 6 hours, or `to` before `from`, is an error the model can fix", async () => {
    const db = openDb(":memory:");
    expect(await runTool("get_track", { mmsi: 230000001, from: iso(0), to: iso(361) }, ctxFor(db))).toMatchObject({ isError: true });
    expect(await runTool("get_track", { mmsi: 230000001, from: iso(10), to: iso(0) }, ctxFor(db))).toMatchObject({ isError: true });
  });

  test("no positions is an answer, not an error", async () => {
    const r = ok(await runTool("get_track", { mmsi: 230000001, from: iso(0), to: iso(60) }, ctxFor(openDb(":memory:"))));
    expect(r.summary).toBe("No positions from 230000001 between 12:00 and 13:00 UTC.");
  });
});

describe("get_vessel", () => {
  test("a readable type from the AIS code and the flag from the MMSI", async () => {
    const db = openDb(":memory:");
    vessel(db, 352001990, { name: "KAVKAZ V", ship_type: 84, length_m: 183, destination: "PRIMORSK", imo: 9301234 });
    const r = ok(await runTool("get_vessel", { mmsi: 352001990 }, ctxFor(db)));
    expect(r.data).toMatchObject({ name: "KAVKAZ V", type_label: "tanker", flag: "Panama", class: "A", length_m: 183 });
    expect(r.summary).toBe("352001990: KAVKAZ V, tanker, Panama flag, class A, 183 m, bound for PRIMORSK.");
  });

  test("a vessel seen only by its positions has no static data", async () => {
    const db = openDb(":memory:");
    vessel(db, 273351080, { ais_class: "B" });
    const r = ok(await runTool("get_vessel", { mmsi: 273351080 }, ctxFor(db)));
    expect(r.data.last_static_at).toBeNull();
    expect(r.summary).toBe("273351080 has sent no static data (class B); the MMSI is Russia's.");
  });

  test("a vessel never seen is unknown", async () => {
    const r = ok(await runTool("get_vessel", { mmsi: 230999999 }, ctxFor(openDb(":memory:"))));
    expect(r.data).toEqual({ unknown: true, flag: "Finland" });
  });
});

describe("get_ingest_health", () => {
  test("lists the outages that overlap the window and the quietest minute", async () => {
    const db = openDb(":memory:");
    const minute = db.query("INSERT INTO ingest_minutes (minute_ts, connected, msg_count) VALUES (?, 1, ?)");
    for (let m = 0; m < 60; m++) minute.run(T0 + m * MIN, m >= 20 && m < 25 ? 0 : 2000 + m);
    db.query("INSERT INTO outages (start_ts, end_ts, cause) VALUES (?, ?, 'no_messages')").run(T0 + 20 * MIN, T0 + 25 * MIN);
    const r = ok(await runTool("get_ingest_health", { from: iso(0), to: iso(60) }, ctxFor(db)));
    expect(r.data).toEqual({
      outages: [{ start: "2026-10-19T12:20:00Z", end: "2026-10-19T12:25:00Z", cause: "no_messages" }],
      min_msg_per_min: 0,
      minutes_known: 60,
    });
    const quiet = ok(await runTool("get_ingest_health", { from: iso(30), to: iso(60) }, ctxFor(db)));
    expect(quiet.summary).toBe("Our ingest had no outage 12:30-13:00 UTC; it received at least 2030 messages every minute.");
  });

  test("against the gap under investigation: an outage before it is not one during it", async () => {
    const db = openDb(":memory:");
    const minute = db.query("INSERT INTO ingest_minutes (minute_ts, connected, msg_count) VALUES (?, 1, ?)");
    for (let m = 0; m < 60; m++) minute.run(T0 + m * MIN, m < 15 ? 0 : 2500);
    db.query("INSERT INTO outages (start_ts, end_ts, cause) VALUES (?, ?, 'disconnected')").run(T0 - 60 * MIN, T0 + 15 * MIN);
    const before = { ...ctxFor(db), gap: { start: T0 + 17 * MIN, end: T0 + 56 * MIN } };
    const r = ok(await runTool("get_ingest_health", { from: iso(0), to: iso(60) }, before));
    expect(r.summary).toBe(
      "Our ingest had 1 outage 12:00-13:00 UTC: 11:00-12:15. None of it during the silence under investigation (12:17-12:56).",
    );
    const during = { ...ctxFor(db), gap: { start: T0 + 5 * MIN, end: T0 + 56 * MIN } };
    expect(ok(await runTool("get_ingest_health", { from: iso(0), to: iso(60) }, during)).summary).toEndWith(
      " 10 min of it during the silence under investigation (12:05-12:56).",
    );
  });

  test("a minute with no messages but no outage is a short drop, not \"at least 0 messages\"", async () => {
    const db = openDb(":memory:");
    const minute = db.query("INSERT INTO ingest_minutes (minute_ts, connected, msg_count) VALUES (?, 1, ?)");
    for (let m = 0; m < 60; m++) minute.run(T0 + m * MIN, m === 38 ? 0 : 2600);
    const r = ok(await runTool("get_ingest_health", { from: iso(0), to: iso(60) }, ctxFor(db)));
    expect(r.summary).toBe("Our ingest had no outage 12:00-13:00 UTC; its quietest minute had no messages, a drop of under 2 min.");
  });

  test("with no health recorded it says so", async () => {
    const r = ok(await runTool("get_ingest_health", { from: iso(0), to: iso(60) }, ctxFor(openDb(":memory:"))));
    expect(r.summary).toBe("Our ingest health for 12:00-13:00 UTC is not known.");
  });
});

describe("get_coverage", () => {
  test("the vessel under investigation does not count against coverage", async () => {
    const db = openDb(":memory:");
    // Two vessels on the same line; the investigated one is silent from minute 20 to 40.
    vessel(db, 230000001);
    vessel(db, 230000002);
    sail(db, 230000001, 59.8125, 24.0, 60, [20, 40]);
    sail(db, 230000002, 59.8125, 24.0, 60);
    computeCoverage(db, T0 + 60 * MIN);
    const point = { lat: 59.8125, lon: 24.0 + (12 * 0.5) / (60 * Math.cos((59.8125 * Math.PI) / 180)), hour_utc: 12 };
    const without = ok(await runTool("get_coverage", point, ctxFor(db, 230000001)));
    expect(without.data).toMatchObject({ ratio: 1, sample_ok: false, neighbors_avg_ratio: 1 });
    const withIt = ok(await runTool("get_coverage", point, ctxFor(db, 230000003)));
    expect(withIt.data.ratio as number).toBeLessThan(1);
    expect(without.summary).toContain("(too small a sample)");
    expect(without.summary).toContain("Too little to tell whether reception there is good or poor.");
  });

  test("a cell no vessel under way crossed is not measured, which is not poor reception", async () => {
    const db = openDb(":memory:");
    computeCoverage(db, T0 + 60 * MIN);
    const r = ok(await runTool("get_coverage", { lat: 59.9, lon: 30.2, hour_utc: 10 }, ctxFor(db)));
    expect(r.data).toMatchObject({ ratio: null, expected_min: 0, neighbors_avg_ratio: null });
    expect(r.summary).toBe(
      "Coverage: no vessel under way crossed this cell at 10 UTC in the last 7 days; nor around it. Too little to tell whether reception there is good or poor.",
    );
  });

  test("a point outside the region is an error", async () => {
    expect(await runTool("get_coverage", { lat: 55, lon: 20, hour_utc: 3 }, ctxFor(openDb(":memory:")))).toMatchObject({
      isError: true,
    });
  });
});

describe("get_nearby", () => {
  test("neighbours that kept reporting, went silent or jumped; far vessels and the vessel itself are left out", async () => {
    const db = openDb(":memory:");
    for (const m of [230000001, 230000002, 230000003, 230000004, 230000005]) vessel(db, m, { name: `V${m % 10}` });
    sail(db, 230000001, 59.8, 24.0, 60, [20, 60]); // under investigation
    sail(db, 230000002, 59.82, 24.0, 60); // kept reporting
    sail(db, 230000003, 59.78, 24.0, 60, [25, 45]); // silent 20 min
    sail(db, 230000004, 59.79, 24.05, 60);
    db.query("INSERT INTO positions (mmsi, ts, lat, lon, sog, cog, nav_status) VALUES (230000004, ?, 60.4, 24.05, 12, 90, 0)").run(
      T0 + 30 * MIN + 15_000,
    ); // 36 nm away for 15 s: a jump
    sail(db, 230000005, 59.3, 24.0, 60); // 30 nm south
    const r = ok(await runTool("get_nearby", { lat: 59.8, lon: 24.1, at: iso(30), window_min: 20 }, ctxFor(db)));
    expect(r.data).toMatchObject({ reporting_count: 2, silent_count: 1, jumping_count: 1, listed: 3 });
    const listed = (r.data.vessels as { mmsi: number; kept_reporting: boolean }[]).map((v) => [v.mmsi, v.kept_reporting]);
    expect(listed.sort()).toEqual([
      [230000002, true],
      [230000003, false],
      [230000004, true],
    ]);
    expect(r.summary).toBe(
      "3 other vessels within 10 nm, 12:10-12:50 UTC: 2 kept reporting (the closest at 0.8 nm), " +
        "1 went silent for 10 min or more (the closest at 1.2 nm); 1 made impossible jumps.",
    );
    const nearest = (kept: boolean) =>
      Math.min(...(r.data.vessels as { distance_nm: number; kept_reporting: boolean }[]).filter((v) => v.kept_reporting === kept).map((v) => v.distance_nm));
    expect([nearest(true), nearest(false)]).toEqual([0.8, 1.2]);
  });

  test("minutes our ingest was down are not the neighbours' silence", async () => {
    const db = openDb(":memory:");
    vessel(db, 230000002);
    vessel(db, 230000003);
    // Nothing arrived from anyone from 12:00 to 12:12, our outage; then one reported throughout and
    // the other went silent for 15 min.
    sail(db, 230000002, 59.82, 24.0, 60, [0, 12]);
    sail(db, 230000003, 59.78, 24.0, 60, [0, 27]);
    db.query("INSERT INTO outages (start_ts, end_ts, cause) VALUES (?, ?, 'disconnected')").run(T0 - 30 * MIN, T0 + 12 * MIN);
    const r = ok(await runTool("get_nearby", { lat: 59.8, lon: 24.1, at: iso(30), window_min: 30 }, ctxFor(db)));
    expect(r.data).toMatchObject({ reporting_count: 1, silent_count: 1 });
    expect(r.summary).toStartWith("2 other vessels within 10 nm, 12:00-12:59 UTC (our ingest was down 12 min of it, not counted): 1 kept reporting");
  });

  test("the window stops at the newest data: the minutes after it are not silence", async () => {
    const db = openDb(":memory:");
    vessel(db, 230000002);
    sail(db, 230000002, 59.82, 24.0, 40);
    const r = ok(await runTool("get_nearby", { lat: 59.8, lon: 24.1, at: iso(30), window_min: 30 }, ctxFor(db)));
    expect(r.data).toMatchObject({ reporting_count: 1, silent_count: 0 });
  });
});
