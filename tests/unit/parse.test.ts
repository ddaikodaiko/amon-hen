import { describe, expect, test } from "bun:test";
import { parseMessage } from "../../src/ingest/parse";
import fixtures from "../fixtures/ais/messages.json";

const T = 1_792_430_101_000;
const { valid, invalid } = fixtures;

describe("parse", () => {
  test("a position takes the MMSI from the topic and the reception time as ts", () => {
    expect(parseMessage(valid.position.topic, valid.position.data, T)).toEqual({
      kind: "position",
      mmsi: 230713000,
      ts: T,
      lat: 60.05,
      lon: 24.95,
      sog: 12.3,
      cog: 254.1,
      heading: 255,
      nav_status: 0,
    });
  });

  test("AIS 'not available' codes become null", () => {
    expect(parseMessage(valid.positionUnavailable.topic, valid.positionUnavailable.data, T)).toMatchObject({
      sog: null,
      cog: null,
      heading: null,
      nav_status: null,
    });
  });

  test("static data with voyage fields is class A; dimensions add up from the reference point", () => {
    expect(parseMessage(valid.staticClassA.topic, valid.staticClassA.data, T)).toEqual({
      kind: "static",
      mmsi: 667002320,
      ts: T,
      name: "LERUO",
      callsign: "9LS2023",
      imo: 9385831,
      ship_type: 80,
      length_m: 180,
      width_m: 32,
      destination: "BRMAO",
      ais_class: "A",
    });
  });

  test("static data without IMO, ETA or draught is class B; empty strings and zeros are null", () => {
    expect(parseMessage(valid.staticNoVoyage.topic, valid.staticNoVoyage.data, T)).toMatchObject({
      ais_class: "B",
      imo: null,
      destination: null,
      length_m: 12,
    });
  });

  for (const bad of invalid) {
    test(`discards: ${bad.why}`, () => {
      expect(parseMessage(bad.topic, bad.data, T)).toBeNull();
    });
  }
});
