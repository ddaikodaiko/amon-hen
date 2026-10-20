import { describe, expect, test } from "bun:test";
import { REGION } from "../../src/config";
import { computeCoverage, coverageAt } from "../../src/coverage/compute";
import { openDb } from "../../src/db";
import { Grid } from "../../src/geo/grid";

// Half-degree cells, so that a vessel at 12 knots stays in one cell for the whole hour and the
// minutes can be counted by hand.
const grid = new Grid(REGION, 0.5);
const T0 = Date.UTC(2026, 9, 19, 12, 0, 0);
const MIN = 60_000;
const LAT = 59.76;
const LON = 23.55;
const CELL = grid.cellId(LAT, LON)!;

type Db = ReturnType<typeof openDb>;

/** A fix every 30 s for `minutes`, eastbound at `knots`, skipping the [from, to) minutes in `silent`. */
function sail(db: Db, mmsi: number, knots: number, minutes: number, silent: [number, number] | null = null, lat = LAT) {
  db.query("INSERT INTO vessels (mmsi, ais_class, flag_mid, updated_at) VALUES (?, 'A', 230, ?)").run(mmsi, T0);
  const insert = db.query("INSERT INTO positions (mmsi, ts, lat, lon, sog, cog, nav_status) VALUES (?, ?, ?, ?, ?, 90, 0)");
  for (let s = 0; s < minutes * 60; s += 30) {
    const min = s / 60;
    if (silent !== null && min >= silent[0] && min < silent[1]) continue;
    const lon = LON + (knots * (s / 3600)) / (60 * Math.cos((lat * Math.PI) / 180));
    insert.run(mmsi, T0 + s * 1000, lat, lon, knots);
  }
}

const END = T0 + 60 * MIN;

describe("coverage in vessel-minutes", () => {
  test("two vessels in a cell, one with a known 20-minute gap: 100 received of 120 expected", () => {
    const db = openDb(":memory:");
    sail(db, 230000001, 12, 60, [20, 40]);
    sail(db, 230000002, 12, 60);
    computeCoverage(db, END, { grid });
    expect(coverageAt(db, LAT, LON, 12, { grid })).toMatchObject({
      cell_id: CELL,
      expected_min: 120,
      received_min: 100,
      ratio: 100 / 120,
      sample_ok: true,
    });
  });

  test("a vessel at anchor (under 3 knots) adds no expected minutes", () => {
    const db = openDb(":memory:");
    sail(db, 230000002, 12, 60);
    sail(db, 230000003, 0.5, 60, [10, 50]);
    computeCoverage(db, END, { grid });
    expect(coverageAt(db, LAT, LON, 12, { grid })).toMatchObject({ expected_min: 60, received_min: 60 });
  });

  test("the investigated vessel's own minutes can be taken out", () => {
    const db = openDb(":memory:");
    sail(db, 230000001, 12, 60, [20, 40]);
    sail(db, 230000002, 12, 60);
    computeCoverage(db, END, { grid });
    expect(coverageAt(db, LAT, LON, 12, { grid, excludeMmsi: 230000001 })).toMatchObject({
      expected_min: 60,
      received_min: 60,
      ratio: 1,
    });
  });

  test("fewer than 30 vessel-minutes is not a sample", () => {
    const db = openDb(":memory:");
    sail(db, 230000002, 12, 20);
    computeCoverage(db, END, { grid });
    expect(coverageAt(db, LAT, LON, 12, { grid })).toMatchObject({ expected_min: 20, sample_ok: false });
  });

  test("minutes inside our own outage are not expected: nobody received anything then", () => {
    const db = openDb(":memory:");
    sail(db, 230000001, 12, 60, [20, 40]);
    db.query("INSERT INTO outages (start_ts, end_ts, cause) VALUES (?, ?, 'no_messages')").run(T0 + 20 * MIN, T0 + 40 * MIN);
    computeCoverage(db, END, { grid });
    expect(coverageAt(db, LAT, LON, 12, { grid })).toMatchObject({ expected_min: 40, received_min: 40 });
  });

  test("a cell nobody crossed has no ratio", () => {
    const db = openDb(":memory:");
    sail(db, 230000002, 12, 60);
    computeCoverage(db, END, { grid });
    expect(coverageAt(db, 60.5, 29.5, 12, { grid })).toMatchObject({ expected_min: 0, ratio: null, sample_ok: false });
  });

  test("only the 7 days before the end of the window count, and recomputing replaces the table", () => {
    const db = openDb(":memory:");
    sail(db, 230000002, 12, 60);
    computeCoverage(db, END + 8 * 24 * 60 * MIN, { grid });
    expect(coverageAt(db, LAT, LON, 12, { grid })).toMatchObject({ expected_min: 0 });
    computeCoverage(db, END, { grid });
    computeCoverage(db, END, { grid });
    expect(coverageAt(db, LAT, LON, 12, { grid })).toMatchObject({ expected_min: 60, received_min: 60 });
  });
});
