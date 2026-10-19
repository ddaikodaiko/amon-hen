import { describe, expect, test } from "bun:test";
import { getMeta, migrate, openDb, SCHEMA_VERSION, setMeta } from "../../src/db";

const tables = (db: ReturnType<typeof openDb>) =>
  db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((r) => r.name);

describe("database", () => {
  test("creates every table of the data model", () => {
    const db = openDb(":memory:");
    expect(tables(db)).toEqual([
      "briefs",
      "budget",
      "candidates",
      "coverage",
      "dossiers",
      "eval_reports",
      "evidence",
      "ingest_minutes",
      "labels",
      "meta",
      "outages",
      "positions",
      "recordings",
      "trace_steps",
      "vessels",
    ]);
    expect(db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version).toBe(SCHEMA_VERSION);
  });

  test("creating the schema twice is harmless", () => {
    const db = openDb(":memory:");
    db.run("PRAGMA user_version = 0");
    expect(() => migrate(db)).not.toThrow();
    expect(tables(db)).toHaveLength(15);
  });

  test("enforces the enumerations", () => {
    const db = openDb(":memory:");
    db.run("INSERT INTO vessels (mmsi, flag_mid, updated_at) VALUES (230000001, 230, 0)");
    expect(() =>
      db.run(
        `INSERT INTO candidates (mmsi, gap_start, start_lat, start_lon, ais_class, state, created_at)
         VALUES (230000001, 0, 60, 25, 'A', 'maybe', 0)`,
      ),
    ).toThrow();
  });

  test("meta keeps small process state", () => {
    const db = openDb(":memory:");
    expect(getMeta(db, "k")).toBeNull();
    setMeta(db, "k", "1");
    setMeta(db, "k", "2");
    expect(getMeta(db, "k")).toBe("2");
  });
});
