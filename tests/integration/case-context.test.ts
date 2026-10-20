import { describe, expect, test } from "bun:test";
import { loadConfig } from "../../src/config";
import { openDb } from "../../src/db";
import { runDetector } from "../../src/detect/run";
import { nearestPlace } from "../../src/geo/places";
import { createApp } from "../../src/server/app";
import { caseContext } from "../../src/server/case-context";
import type { CandidateDetail, CandidateList } from "../../src/shared/api";
import { at, END, PORTS, play, T0 } from "../fixtures/ais/gaps";

// What the panel says about a gap before any investigation, on the synthetic tracks: 230000101
// sails east at 12 knots through its 45 min of silence; 230000108 lies at anchor off Kotka.

function world() {
  const db = openDb(":memory:");
  play(db, T0, END);
  runDetector(db, END, { ports: PORTS });
  const id = (mmsi: number) => db.query<{ id: number }, [number]>("SELECT id FROM candidates WHERE mmsi = ?").get(mmsi)!.id;
  return { db, id };
}

describe("nearestPlace", () => {
  test("names the nearest place, how far and which way", () => {
    expect(nearestPlace(60.16, 24.955)).toEqual({ name: "Helsinki", country: "FI", km: 0, dir: null });
    expect(nearestPlace(59.95, 29.7)).toEqual({ name: "Kronstadt", country: "RU", km: 6, dir: "SW" });
    expect(nearestPlace(59.44, 24.7).name).toBe("Tallinn");
  });
});

describe("case context", () => {
  test("a vessel that kept sailing through its silence", async () => {
    const { db, id } = world();
    const c = await caseContext(db, id(230000101));
    expect(c.moved_km).toBeCloseTo(16.7, 0);
    expect(c.implied_kn).toBeCloseTo(12, 0);
    expect(c.speed_before_kn).toBeCloseTo(12, 0);
    expect(c.near_end).not.toBeNull();
    // Its lane-mates kept reporting while it was silent.
    expect(c.nearby.total).toBeGreaterThan(0);
    expect(c.nearby.kept_reporting).toBeGreaterThan(0);
    expect(c.other_silences_total).toBe(0);
    // Three hours before the gap to two after it.
    expect(c.track[0]![0]).toBeGreaterThanOrEqual(at(100) - 30_000 - 3 * 3_600_000);
    expect(c.track.some(([ts]) => ts > at(145))).toBe(true);
  });

  test("a vessel at anchor stayed where it was", async () => {
    const { db, id } = world();
    const c = await caseContext(db, id(230000108));
    expect(c.near_start).toMatchObject({ name: "Kotka", country: "FI", dir: "SW" });
    expect(c.moved_km).toBeLessThan(0.5);
    expect(c.implied_kn).toBeLessThan(1);
  });

  test("its other silences, but not our own outages", async () => {
    const { db, id } = world();
    const anchored = id(230000108);
    const insert = db.query(
      `INSERT INTO candidates (mmsi, gap_start, gap_end, start_lat, start_lon, ais_class, state, discard_reason, created_at)
       VALUES (230000108, ?, ?, 60.38, 26.829, 'A', 'discarded', ?, 0)`,
    );
    insert.run(at(10), at(50), "berth");
    insert.run(at(20), at(60), "own_outage");
    const c = await caseContext(db, anchored);
    expect(c.other_silences_total).toBe(1);
    expect(c.other_silences).toEqual([{ id: expect.any(Number), gap_start: at(10), duration_min: 40 }]);
  });

  test("the API gives it with the case, and the place in the list", async () => {
    const { db, id } = world();
    const app = createApp({ db, config: loadConfig({}), mode: "public" });
    const detail = (await (await app(new Request(`http://localhost/api/candidates/${id(230000108)}`))).json()) as CandidateDetail;
    expect(detail.context.near_start.name).toBe("Kotka");
    const list = (await (await app(new Request("http://localhost/api/candidates"))).json()) as CandidateList;
    expect(list.items.every((c) => typeof c.near.name === "string")).toBe(true);
  });
});
