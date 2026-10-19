import { describe, expect, test } from "bun:test";
import { REGION } from "../../src/config";
import { Grid } from "../../src/geo/grid";
import { bearingDeg, distanceNm, impliedKnots } from "../../src/geo/haversine";
import { flagOf, midOf } from "../../src/geo/mid";
import { berthAt, headingOut, inPolygon, loadPorts } from "../../src/geo/polygons";

describe("grid", () => {
  const grid = new Grid();

  test("covers the region with 0.025° cells", () => {
    expect(grid.nrows).toBe(64);
    expect(grid.ncols).toBe(316);
  });

  test("a point maps to the cell whose bounds contain it", () => {
    const id = grid.cellId(60.15, 24.95)!;
    const b = grid.cellBounds(id);
    expect(b.latMin).toBeLessThanOrEqual(60.15);
    expect(b.latMax).toBeGreaterThan(60.15);
    expect(b.lonMin).toBeLessThanOrEqual(24.95);
    expect(b.lonMax).toBeGreaterThan(24.95);
  });

  test("the south-west corner is cell 0 and the region is half-open", () => {
    expect(grid.cellId(REGION.lat_min, REGION.lon_min)).toBe(0);
    expect(grid.cellId(REGION.lat_max, 25)).toBeNull();
    expect(grid.cellId(59.1, 25)).toBeNull();
    expect(grid.cellId(60, 31)).toBeNull();
  });

  test("neighbors: 8 inside, 3 in a corner", () => {
    expect(grid.neighbors(grid.cellId(60, 25)!)).toHaveLength(8);
    expect(grid.neighbors(0).sort((a, b) => a - b)).toEqual([1, grid.ncols, grid.ncols + 1]);
  });
});

describe("distances", () => {
  const helsinki = { lat: 60.1675, lon: 24.9525 };
  const tallinn = { lat: 59.4441, lon: 24.7536 };

  test("Helsinki to Tallinn is about 44 nm, heading south", () => {
    expect(distanceNm(helsinki, tallinn)).toBeCloseTo(43.7, 0);
    expect(bearingDeg(helsinki, tallinn)).toBeGreaterThan(180);
    expect(bearingDeg(helsinki, tallinn)).toBeLessThan(195);
  });

  test("one minute of latitude is one nautical mile", () => {
    expect(distanceNm({ lat: 60, lon: 25 }, { lat: 60 + 1 / 60, lon: 25 })).toBeCloseTo(1, 2);
  });

  test("implied speed", () => {
    expect(impliedKnots(helsinki, tallinn, 2 * 3_600_000)).toBeCloseTo(21.9, 0);
    expect(impliedKnots(helsinki, tallinn, 0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("polygons", () => {
  // A square around Vuosaari harbour, with a hole that is not part of it.
  const ports = loadPorts({
    features: [
      {
        properties: { name: "Vuosaari" },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [25.17, 60.2],
              [25.21, 60.2],
              [25.21, 60.22],
              [25.17, 60.22],
              [25.17, 60.2],
            ],
            [
              [25.2, 60.215],
              [25.205, 60.215],
              [25.205, 60.218],
              [25.2, 60.218],
              [25.2, 60.215],
            ],
          ],
        },
      },
    ],
  });

  test("a point in Vuosaari harbour is in a berth; one mid-gulf is not", () => {
    expect(berthAt(60.21, 25.19, ports)).toBe("Vuosaari");
    expect(berthAt(59.8, 25.5, ports)).toBeNull();
  });

  test("holes are outside", () => {
    expect(inPolygon(60.216, 25.202, ports[0]!.polygons[0]!)).toBe(false);
  });

  test("heading out only near the edge and pointing outwards", () => {
    expect(headingOut(59.7, 22.52, 270)).toBe(true); // west edge, sailing west
    expect(headingOut(59.7, 22.52, 90)).toBe(false); // west edge, sailing east (coming in)
    expect(headingOut(59.7, 25, 270)).toBe(false); // mid-gulf
    expect(headingOut(59.7, 22.52, null)).toBe(false);
  });
});

describe("flags", () => {
  test("MID → country", () => {
    expect(midOf(230123456)).toBe(230);
    expect(flagOf(230123456)).toBe("Finland");
    expect(flagOf(273123456)).toBe("Russia");
    expect(flagOf(999123456)).toBeNull();
  });
});
