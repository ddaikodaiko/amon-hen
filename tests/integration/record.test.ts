import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { investigate } from "../../src/agent/investigate";
import { FakeClient, type ScriptedReply } from "../../src/agent/model";
import { loadConfig } from "../../src/config";
import { getMeta, openDb } from "../../src/db";
import { runDetector } from "../../src/detect/run";
import { record } from "../../src/replay/record";
import { at, END, PORTS, play, T0 } from "../fixtures/ais/gaps";

// bun run record (T038): a window copied to its own database, with its cases whole.

const dir = mkdtempSync(join(tmpdir(), "vigia-record-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const script = (name: string): ScriptedReply[] =>
  (JSON.parse(readFileSync(join(import.meta.dir, "../fixtures/scripts", `${name}.json`), "utf8")) as { replies: ScriptedReply[] }).replies;

async function source() {
  const db = openDb(":memory:");
  play(db, T0, END);
  runDetector(db, END, { ports: PORTS });
  const { profiles } = loadConfig({});
  const id = (mmsi: number) => db.query<{ id: number }, [number]>("SELECT id FROM candidates WHERE mmsi = ?").get(mmsi)!.id;
  await investigate(db, id(230000101), { primary: new FakeClient(script("happy")), profiles, capUsd: 0, now: () => END });
  await investigate(db, id(230000108), {
    primary: new FakeClient(script("inconclusive")),
    escalate: new FakeClient(script("escalated"), "haiku"),
    profiles,
    capUsd: 1,
    now: () => END,
  });
  db.query("INSERT INTO labels (candidate_id, value, author, created_at) VALUES (?, 'likely_dark', 'test', 0)").run(id(230000101));
  return db;
}

const count = (db: ReturnType<typeof openDb>, sql: string) => db.query<{ n: number }, []>(`SELECT count(*) AS n FROM (${sql})`).get()!.n;
// From 07:00 to 09:00: the gaps that start at 07:39:30 are in, the one at 06:59:30 is out.
const FROM = at(60);
const TO = at(180);

describe("record --kind demo", () => {
  test("one position per vessel and minute, and only from the window", async () => {
    const src = await source();
    const out = join(dir, "demo.sqlite");
    const stats = record(src, { from: FROM, to: TO, kind: "demo", out });
    const db = openDb(out);
    const perMinute = `SELECT mmsi, ts / 60000 FROM positions WHERE ts >= ${FROM} AND ts < ${TO} GROUP BY 1, 2`;
    expect(count(db, "SELECT * FROM positions")).toBe(count(src, perMinute));
    expect(stats.positions).toBe(count(src, perMinute));
    expect(count(db, "SELECT mmsi, ts / 60000 FROM positions GROUP BY 1, 2 HAVING count(*) > 1")).toBe(0);
    expect(count(db, `SELECT * FROM positions WHERE ts < ${FROM} OR ts >= ${TO}`)).toBe(0);
    // Positions are stored every 30 s: the demo keeps about half.
    expect(stats.positions).toBeLessThan(count(src, `SELECT * FROM positions WHERE ts >= ${FROM} AND ts < ${TO}`) * 0.6);
    db.close();
  });

  test("the cases of the window come whole: candidates, dossiers, steps and evidence", async () => {
    const src = await source();
    const out = join(dir, "cases.sqlite");
    record(src, { from: FROM, to: TO, kind: "demo", out });
    const db = openDb(out);
    const inWindow = `SELECT id FROM candidates WHERE gap_start >= ${FROM} AND gap_start < ${TO}`;
    expect(db.query<{ id: number }, []>("SELECT id FROM candidates ORDER BY id").all()).toEqual(
      src.query<{ id: number }, []>(`${inWindow} ORDER BY id`).all(),
    );
    expect(count(db, "SELECT * FROM candidates WHERE mmsi = 230000109")).toBe(0);
    for (const table of ["dossiers", "trace_steps", "evidence"]) {
      const of = table === "dossiers" ? `candidate_id IN (${inWindow})` : `dossier_id IN (SELECT id FROM dossiers WHERE candidate_id IN (${inWindow}))`;
      expect({ table, n: count(db, `SELECT * FROM ${table}`) }).toEqual({ table, n: count(src, `SELECT * FROM ${table} WHERE ${of}`) });
    }
    expect(count(db, "SELECT * FROM dossiers")).toBe(2);
    expect(count(db, "SELECT * FROM evidence e JOIN trace_steps s ON s.dossier_id = e.dossier_id AND s.idx = e.step_idx")).toBe(
      count(db, "SELECT * FROM evidence"),
    );
    // No ground truth in the public demo.
    expect(count(db, "SELECT * FROM labels")).toBe(0);
    db.close();
  });

  test("the copy says it is done up to the end, is one file, and the source keeps a note", async () => {
    const src = await source();
    const out = join(dir, "meta.sqlite");
    record(src, { from: FROM, to: TO, kind: "demo", out });
    const db = openDb(out);
    expect([getMeta(db, "detect_scanned_until"), getMeta(db, "health_closed_until")]).toEqual([String(TO), String(TO)]);
    expect(db.query("SELECT start_ts, end_ts, kind FROM recordings").all()).toEqual([{ start_ts: FROM, end_ts: TO, kind: "demo" }]);
    db.close();
    expect(src.query("SELECT kind, path FROM recordings").all()).toEqual([{ kind: "demo", path: out }]);
  });
});

describe("record --kind eval", () => {
  test("keeps every position and the labels", async () => {
    const src = await source();
    const out = join(dir, "eval.sqlite");
    const stats = record(src, { from: FROM, to: TO, kind: "eval", out });
    expect(stats.positions).toBe(count(src, `SELECT * FROM positions WHERE ts >= ${FROM} AND ts < ${TO}`));
    expect(stats.labels).toBe(1);
    // With every position, the detector finds nothing new in the copy: the set is reproducible.
    const db = openDb(out);
    expect(runDetector(db, TO, { ports: PORTS }).created).toBe(0);
    db.close();
  });
});
