import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { investigate } from "../../src/agent/investigate";
import { FakeClient, type ScriptedReply } from "../../src/agent/model";
import { generateBrief } from "../../src/brief/sections";
import { loadConfig } from "../../src/config";
import { openDb, openReadOnly } from "../../src/db";
import { runDetector } from "../../src/detect/run";
import { buildReport, saveReport } from "../../src/eval/report";
import { buildDemo, DemoBuildError } from "../../src/replay/demo-build";
import { at, END, PORTS, play, T0 } from "../fixtures/ais/gaps";

// bun run demo:build (T047) on the synthetic tracks: the window 07:00-09:00 holds the gaps of
// 230000101, 230000104 and 230000108, none investigated yet; 230000109 starts before it.

const dir = mkdtempSync(join(tmpdir(), "vigia-demo-build-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const script = (name: string): ScriptedReply[] =>
  (JSON.parse(readFileSync(join(import.meta.dir, "../fixtures/scripts", `${name}.json`), "utf8")) as { replies: ScriptedReply[] }).replies;
const config = loadConfig({});
const happy = (n: number) => new FakeClient(Array.from({ length: n }, () => script("happy")).flat());

function world() {
  const db = openDb(":memory:");
  play(db, T0, END);
  runDetector(db, END, { ports: PORTS });
  return db;
}

const deps = (primary: FakeClient) => ({ primary, profiles: config.profiles, capUsd: 0, now: () => END });

describe("demo:build", () => {
  test("investigates the window's cases first, then records it with the briefs and reports", async () => {
    const db = world();
    const done = db.query<{ id: number }, []>("SELECT id FROM candidates WHERE mmsi = 230000101").get()!.id;
    await investigate(db, done, deps(happy(1)));
    generateBrief(db, config, "2026-10-20", END);
    generateBrief(db, config, "2026-10-23", END);
    db.query("INSERT INTO labels (candidate_id, value, author, created_at) VALUES (?, 'likely_dark', 'test', 0)").run(done);
    saveReport(db, buildReport(db, { now: END }));

    const client = happy(2);
    const out = join(dir, "demo.sqlite");
    const r = await buildDemo(db, { from: at(60), to: at(180), out, investigate: deps(client) });
    // 230000101 had its dossier already; 230000104 and 230000108 are done now. The two gaps the
    // detector threw out in the window go with them.
    expect(r).toMatchObject({ investigated: 2, candidates: 5, dossiers: 3, briefs: 1, reports: 1 });
    expect(client.remaining).toBe(0);

    const demo = openReadOnly(out);
    expect(demo.query("SELECT state, count(*) AS n FROM candidates GROUP BY state ORDER BY state").all()).toEqual([
      { state: "discarded", n: 2 },
      { state: "investigated", n: 3 },
    ]);
    expect(demo.query("SELECT date FROM briefs").all()).toEqual([{ date: "2026-10-20" }]);
    expect(demo.query("SELECT count(*) AS n FROM eval_reports").get()).toEqual({ n: 1 });
    expect(demo.query("SELECT count(*) AS n FROM labels").get()).toEqual({ n: 0 });
    // One file, readable without writing: no WAL.
    expect(demo.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "delete" });
    demo.close();
    expect(existsSync(`${out}-wal`)).toBe(false);
  });

  test("without the model it stops before recording anything", async () => {
    const db = world();
    const down = new FakeClient([]);
    down.down = "the PC is off";
    const out = join(dir, "none.sqlite");
    await expect(buildDemo(db, { from: at(60), to: at(180), out, investigate: deps(down) })).rejects.toThrow(DemoBuildError);
    expect(existsSync(out)).toBe(false);
  });

  test("a demo over the size limit is refused", async () => {
    const db = world();
    const out = join(dir, "big.sqlite");
    await expect(buildDemo(db, { from: at(60), to: at(180), out, investigate: deps(happy(3)), maxBytes: 10_000 })).rejects.toThrow(/over the 0 MB/);
  });
});
