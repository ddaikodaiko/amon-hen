import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { getMeta, migrate, openDb, SCHEMA_VERSION, setMeta } from "../../src/db";
import schemaV1 from "../../src/db/schema.sql" with { type: "text" };

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

  test("a version 1 database is brought up to date, keeping its cases", () => {
    const db = new Database(":memory:", { strict: true });
    db.run(schemaV1);
    db.run("PRAGMA user_version = 1");
    db.run("INSERT INTO vessels (mmsi, flag_mid, updated_at) VALUES (230000001, 230, 0)");
    const add = db.query("INSERT INTO candidates (mmsi, gap_start, start_lat, start_lon, ais_class, state, trigger_at, created_at) VALUES (230000001, ?, 60, 25, 'A', ?, ?, 0)");
    add.run(1, "investigated", 5000);
    add.run(2, "pending", 7000);
    migrate(db);
    expect(db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version).toBe(SCHEMA_VERSION);
    // Version 1 rewrote trigger_at at each attempt: for a case past the queue, that is when it began.
    expect(db.query("SELECT state, trigger_at, started_at FROM candidates ORDER BY gap_start").all()).toEqual([
      { state: "investigated", trigger_at: 5000, started_at: 5000 },
      { state: "pending", trigger_at: 7000, started_at: null },
    ]);
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
