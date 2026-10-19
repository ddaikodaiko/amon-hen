import { describe, expect, test } from "bun:test";
import { backoffDelay, buildSubscription } from "../../src/ingest/aisstream";

describe("buildSubscription", () => {
  test("one [lat, lon] box over the Strait and the five message types", () => {
    expect(buildSubscription("k")).toEqual({
      APIKey: "k",
      BoundingBoxes: [
        [
          [35.7, -6.2],
          [36.3, -5.0],
        ],
      ],
      FilterMessageTypes: [
        "PositionReport",
        "StandardClassBPositionReport",
        "ExtendedClassBPositionReport",
        "ShipStaticData",
        "StaticDataReport",
      ],
    });
  });
});

describe("backoffDelay", () => {
  test("doubles from 1 s and stops at 60 s", () => {
    expect([0, 1, 2, 5, 6, 20].map((a) => backoffDelay(a, 1_000, 60_000))).toEqual([
      1_000, 2_000, 4_000, 32_000, 60_000, 60_000,
    ]);
  });
});
