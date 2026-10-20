import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeClient, type ScriptedReply } from "../../src/agent/model";
import { writeNarrative } from "../../src/brief/narrative";
import { generateBrief, readBrief } from "../../src/brief/sections";
import { loadConfig } from "../../src/config";
import { computeCoverage } from "../../src/coverage/compute";
import { openDb } from "../../src/db";
import { closeMinutes } from "../../src/ingest/health";
import { ingestRaw } from "../../src/ingest/pipeline";
import { SerialInvestigator } from "../../src/server/investigator";
import { type JobsDeps, LiveJobs } from "../../src/server/jobs";
import { ModelStatus } from "../../src/server/model-status";
import { END, PORTS, play, T0 } from "../fixtures/ais/gaps";

// The live queue (T059): the jobs, the investigator and the model check together, with scripted
// models and a PC that can be switched off.

const MIN = 60_000;
const script = (name: string): ScriptedReply[] =>
  (JSON.parse(readFileSync(join(import.meta.dir, "../fixtures/scripts", `${name}.json`), "utf8")) as { replies: ScriptedReply[] }).replies;
type Db = ReturnType<typeof openDb>;

function live(db: Db, start: number, narrate?: JobsDeps["narrate"]) {
  let now = start;
  let pcOff = false;
  const probe = new FakeClient([]);
  const model = new ModelStatus(probe);
  const briefings: string[] = [];
  const investigator = new SerialInvestigator(
    db,
    loadConfig({}),
    (p) => {
      const client = new FakeClient(script("happy"), p.name);
      client.down = pcOff ? "the PC is off" : null;
      const create = client.create.bind(client);
      client.create = (params) => {
        if (client.calls.length === 0) briefings.push(JSON.stringify(params.messages[0]));
        return create(params);
      };
      return client;
    },
    () => now,
  );
  const jobs = new LiveJobs({ db, investigator, model, coverage: async (end) => computeCoverage(db, end), ports: PORTS, now: () => now, narrate });
  return {
    jobs,
    investigator,
    briefings,
    advance: (ms: number) => (now += ms),
    power: async (on: boolean) => {
      pcOff = !on;
      probe.down = on ? null : "the PC is off";
      await model.check();
    },
  };
}

const states = (db: Db) =>
  db.query<{ state: string; n: number }, []>("SELECT state, count(*) AS n FROM candidates GROUP BY state ORDER BY state").all();

describe("live queue", () => {
  test("12 h with the PC off: the 30 cases wait; switched on, all 30 are investigated in order of arrival", async () => {
    const db = openDb(":memory:");
    db.run("INSERT INTO vessels (mmsi, flag_mid, updated_at) VALUES (230000001, 230, 0)");
    // Inserted newest first, so the ids run against the order of arrival.
    const add = db.query("INSERT INTO candidates (mmsi, gap_start, start_lat, start_lon, ais_class, state, trigger_at, created_at) VALUES (230000001, ?, 59.8, 25, 'A', 'pending', ?, ?)");
    for (let i = 29; i >= 0; i--) add.run(T0 + i * 20 * MIN, T0 + i * 20 * MIN + 30 * MIN, T0);
    const arrival = db.query<{ id: number }, []>("SELECT id FROM candidates ORDER BY trigger_at").all().map((r) => r.id);
    const triggers = db.query("SELECT id, trigger_at FROM candidates ORDER BY id").all();

    const w = live(db, T0 + 10 * 60 * MIN);
    await w.power(false);
    for (let m = 0; m < 12 * 60; m++) {
      w.jobs.tick();
      w.advance(MIN);
      // The model is checked every 2 minutes.
      if (m % 2 === 1) await w.power(false);
    }
    await w.investigator.idle();
    expect(states(db)).toEqual([{ state: "pending_no_model", n: 30 }]);
    expect(db.query("SELECT 1 FROM dossiers").all()).toHaveLength(0);
    expect(w.briefings).toHaveLength(0);

    await w.power(true);
    expect(w.jobs.work()).toBe(30);
    await w.investigator.idle();
    expect(states(db)).toEqual([{ state: "investigated", n: 30 }]);
    // None lost, one dossier each, in order of arrival; their place in the queue never changed.
    expect(db.query<{ candidate_id: number }, []>("SELECT candidate_id FROM dossiers ORDER BY id").all().map((d) => d.candidate_id)).toEqual(arrival);
    expect(db.query("SELECT id, trigger_at FROM candidates ORDER BY id").all()).toEqual(triggers);
  });

  test("the PC goes off halfway: the rest wait for it, keep their place, and are done when it is back", async () => {
    const db = openDb(":memory:");
    play(db, T0, END);
    const w = live(db, END);
    await w.power(true);
    // Hands the four cases over; the first one starts at once.
    w.jobs.tick();
    await w.power(false);
    await w.investigator.idle();
    expect(states(db)).toContainEqual({ state: "investigated", n: 1 });
    expect(states(db)).toContainEqual({ state: "pending_no_model", n: 3 });
    const waiting = db.query("SELECT id, trigger_at FROM candidates WHERE state = 'pending_no_model' ORDER BY trigger_at, id").all();

    // While it is off, nothing is handed over.
    w.advance(MIN);
    w.jobs.tick();
    await w.investigator.idle();
    expect(w.briefings).toHaveLength(1);

    await w.power(true);
    expect(w.jobs.work()).toBe(3);
    await w.investigator.idle();
    expect(states(db)).toContainEqual({ state: "investigated", n: 4 });
    const done = db.query<{ id: number }, []>("SELECT c.id FROM dossiers d JOIN candidates c ON c.id = d.candidate_id ORDER BY d.id").all();
    expect(done.slice(1).map((d) => d.id)).toEqual(waiting.map((c) => (c as { id: number }).id));
  });

  test("a gap that comes back after the 6 h trigger gets version 2 of its dossier", async () => {
    const db = openDb(":memory:");
    play(db, T0, END);
    const w = live(db, END);
    await w.power(true);
    w.jobs.tick();
    await w.investigator.idle();
    const open = db.query<{ id: number }, []>("SELECT id FROM candidates WHERE mmsi = 230000109").get()!.id;
    expect(db.query("SELECT version FROM dossiers WHERE candidate_id = ?").all(open)).toEqual([{ version: 1 }]);
    expect(w.briefings.at(-1)).toContain("has not reported again");
    const before = db.query("SELECT count(*) AS n FROM dossiers").get();

    // 230000109 reports again, 7.5 h after it went silent.
    for (let s = 0; s < 300; s += 10) {
      ingestRaw(db, "vessels-v2/230000109/location", { lat: 59.85, lon: 24.6, sog: 12, cog: 90, heading: 90, navStat: 0 }, END + s * 1000);
    }
    closeMinutes(db, END + 5 * MIN);
    w.advance(5 * MIN);
    expect(w.jobs.detect()).toMatchObject({ reopened: 1 });
    w.jobs.work();
    await w.investigator.idle();
    expect(db.query("SELECT version FROM dossiers WHERE candidate_id = ? ORDER BY version").all(open)).toEqual([{ version: 1 }, { version: 2 }]);
    expect(w.briefings.at(-1)).toContain("It reported again at");
    // Only that one was looked at again.
    expect(db.query<{ n: number }, []>("SELECT count(*) AS n FROM dossiers").get()!.n).toBe((before as { n: number }).n + 1);
    w.jobs.work();
    await w.investigator.idle();
    expect(db.query("SELECT version FROM dossiers WHERE candidate_id = ?").all(open)).toHaveLength(2);
  });

  test("with the queue empty, the worker has the model write the brief's paragraph, once", async () => {
    const db = openDb(":memory:");
    play(db, T0, END);
    const config = loadConfig({});
    const asked: string[] = [];
    const w = live(db, END, (date) => {
      asked.push(date);
      return writeNarrative(db, date, { client: new FakeClient([{ content: [{ type: "text", text: "A quiet day." }], usage: { input_tokens: 10, output_tokens: 5 } }]), profile: config.profiles.local, capUsd: 0 });
    });
    await w.power(true);
    w.jobs.tick();
    await w.investigator.idle();
    // The day's brief, from the four dossiers just written; its paragraph waits for the model.
    generateBrief(db, config, "2026-10-20", END);
    expect(asked).toEqual([]);
    w.jobs.work();
    await w.jobs.settled();
    expect(asked).toEqual(["2026-10-20"]);
    expect(readBrief(db, "2026-10-20")).toMatchObject({ narrative_state: "done", narrative: "A quiet day." });
    w.jobs.work();
    await w.jobs.settled();
    expect(asked).toHaveLength(1);
  });
});
