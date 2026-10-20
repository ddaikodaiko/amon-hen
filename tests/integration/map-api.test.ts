import { describe, expect, test } from "bun:test";
import { loadConfig } from "../../src/config";
import { computeCoverage } from "../../src/coverage/compute";
import { openDb } from "../../src/db";
import { createApp } from "../../src/server/app";
import type { CoverageLayer, VesselDetail } from "../../src/shared/api";
import { at, END, play, T0 } from "../fixtures/ais/gaps";

// GET /api/coverage and GET /api/vessels/:mmsi (T042) over the synthetic tracks.

function app() {
  const db = openDb(":memory:");
  play(db, T0, END);
  computeCoverage(db, END);
  return createApp({ db, config: loadConfig({}), mode: "public", modelAvailable: () => null });
}
const get = async <T>(path: string) => {
  const res = await app()(new Request(`http://localhost${path}`));
  return { status: res.status, body: (await res.json()) as T };
};

describe("GET /api/coverage", () => {
  test("the cells of that hour, with their corner, ratio and sample", async () => {
    const { status, body } = await get<CoverageLayer>("/api/coverage?hour=7");
    expect(status).toBe(200);
    expect(body).toMatchObject({ hour: 7, cell_deg: 0.025, sample_min: 30, window: { end: END } });
    expect(body.cells.length).toBeGreaterThan(0);
    for (const [lat, lon, ratio, expected] of body.cells) {
      expect(lat).toBeWithin(59.2, 60.8);
      expect(lon).toBeWithin(22.5, 30.4);
      expect(ratio).toBeWithin(0, 1.0001);
      expect(expected).toBeGreaterThan(0);
    }
    // The 45-minute gap of 230000101 at 07:39 leaves cells it crossed without what was expected.
    expect(body.cells.some(([, , ratio]) => ratio < 1)).toBe(true);
  });

  test("an hour with no traffic is empty; an hour that does not exist is a 400", async () => {
    expect((await get<CoverageLayer>("/api/coverage?hour=3")).body.cells).toEqual([]);
    expect((await get("/api/coverage?hour=24")).status).toBe(400);
  });
});

describe("GET /api/vessels/:mmsi", () => {
  test("what the vessel says about itself and its track up to `at`", async () => {
    const { body } = await get<VesselDetail>(`/api/vessels/230000101?at=${at(120)}&hours=1`);
    expect(body).toMatchObject({ mmsi: 230000101, name: "TEST 230000101", flag: "Finland", type_label: "cargo", ais_class: "A" });
    const times = body.track.map((p) => p[0]);
    expect(times[0]).toBeGreaterThan(at(60));
    // Silent from 07:40: the track stops there.
    expect(times.at(-1)).toBe(at(100) - 30_000);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  test("404 for a vessel we never heard, 400 for a number that is not an MMSI", async () => {
    expect((await get("/api/vessels/230999999")).status).toBe(404);
    expect((await get("/api/vessels/12")).status).toBe(400);
  });
});
