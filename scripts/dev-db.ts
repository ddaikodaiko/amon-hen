import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { investigate } from "../src/agent/investigate";
import { FakeClient, type ScriptedReply } from "../src/agent/model";
import { loadConfig, type ProfileName } from "../src/config";
import { openDb } from "../src/db";
import { runDetector } from "../src/detect/run";
import { END, PORTS, play, T0 } from "../tests/fixtures/ais/gaps";

// A database for working on the panel without the model: the synthetic tracks of the tests, with
// cases investigated by the scripted models, one in each state the case views show.
//
//   bun run scripts/dev-db.ts --out data/dev.sqlite
//   VIGIA_DB=data/dev.sqlite bun run server   (and bun run --cwd panel dev)

const { values } = parseArgs({ options: { out: { type: "string", default: "data/dev.sqlite" } } });
const out = values.out!;
for (const suffix of ["", "-wal", "-shm"]) rmSync(`${out}${suffix}`, { force: true });

const script = (name: string): ScriptedReply[] =>
  (JSON.parse(readFileSync(join(import.meta.dir, "../tests/fixtures/scripts", `${name}.json`), "utf8")) as { replies: ScriptedReply[] }).replies;
const fake = (name: string, profile: ProfileName = "local") => new FakeClient(script(name), profile);

const db = openDb(out);
play(db, T0, END);
runDetector(db, END, { ports: PORTS });
const id = (mmsi: number) => db.query<{ id: number }, [number]>("SELECT id FROM candidates WHERE mmsi = ?").get(mmsi)!.id;
const { profiles } = loadConfig({});
// Enough for the worst case of a Haiku call (16k output tokens), not for many.
const deps = { profiles, capUsd: 0.05, now: () => END };

// 45 min at sea: likely_dark, then a second version that says coverage_gap.
await investigate(db, id(230000101), { ...deps, primary: fake("happy") });
await investigate(db, id(230000101), { ...deps, primary: fake("tool-fails"), now: () => END + 3_600_000 });
// Anchored off Kotka: inconclusive locally, escalated to Haiku.
await investigate(db, id(230000108), { ...deps, primary: fake("inconclusive"), escalate: fake("escalated", "haiku") });
// Class B, 70 min: Haiku over what is left of the cap.
await investigate(db, id(230000104), { ...deps, primary: fake("happy", "haiku"), capUsd: 0 });
// Open for 6 h: the model drops halfway.
await investigate(db, id(230000109), { ...deps, primary: fake("connection-drop") });

const states = db.query<{ state: string; n: number }, []>("SELECT state, count(*) AS n FROM candidates GROUP BY state").all();
console.log(`${out}: ${states.map((s) => `${s.n} ${s.state}`).join(", ")}`);
db.close();
