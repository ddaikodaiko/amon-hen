import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { investigate } from "../../src/agent/investigate";
import { FakeClient, type ScriptedReply } from "../../src/agent/model";
import { loadConfig } from "../../src/config";
import { openDb } from "../../src/db";
import { runDetector } from "../../src/detect/run";
import { recordedRange, ReplayClock } from "../../src/replay/clock";
import { createApp } from "../../src/server/app";
import { type StreamEvent, StreamSession } from "../../src/server/stream";
import type { StreamEvents } from "../../src/shared/api";
import { at, END, PORTS, play, T0 } from "../fixtures/ais/gaps";

// The events of GET /api/stream (T041) over the synthetic tracks. 230000101 goes silent at
// 07:39:30 and is back at 08:25 (investigated); 230000109 goes silent at 06:59:30 for good.
// The other cases of the fixture (a class B gap, the anchorage) are on the map too.

const script = (name: string): ScriptedReply[] =>
  (JSON.parse(readFileSync(join(import.meta.dir, "../fixtures/scripts", `${name}.json`), "utf8")) as { replies: ScriptedReply[] }).replies;

async function world() {
  const db = openDb(":memory:");
  play(db, T0, END);
  runDetector(db, END, { ports: PORTS });
  const id = (mmsi: number) => db.query<{ id: number }, [number]>("SELECT id FROM candidates WHERE mmsi = ?").get(mmsi)!.id;
  const { profiles } = loadConfig({});
  await investigate(db, id(230000101), { primary: new FakeClient(script("happy")), profiles, capUsd: 0, now: () => END });
  const cases = db.query<{ id: number }, []>("SELECT id FROM candidates WHERE state NOT IN ('detected', 'discarded')").all();
  return { db, a45: id(230000101), open: id(230000109), cases: cases.map((c) => c.id).sort() };
}

/** A replay session at 60× whose wall clock the test moves. */
function replay(db: ReturnType<typeof openDb>, start: number) {
  let wall = 0;
  const clock = new ReplayClock(recordedRange(db)!, 60, start, () => wall);
  const session = new StreamSession(db, "replay", () => clock.now(), clock);
  return { session, clock, to: (t: number) => (wall = (t - start) / 60) };
}

const of = <K extends keyof StreamEvents>(events: StreamEvent[], kind: K): StreamEvents[K][] =>
  events.filter((e) => e.event === kind).map((e) => e.data as StreamEvents[K]);

describe("replay stream", () => {
  test("gaps appear when the detector would have flagged them, and verdicts when the agent would have run", async () => {
    const { db, a45, open } = await world();
    const r = replay(db, T0);
    const hello = r.session.open();
    expect(of(hello, "hello")[0]).toMatchObject({ mode: "replay", t: T0, speed: 60 });
    expect(of(hello, "candidate")).toEqual([]);

    // 230000109 went silent at 06:59:30: flagged 30 min later.
    r.to(at(89));
    expect(of(r.session.tick(), "candidate")).toEqual([]);
    r.to(at(90));
    expect(of(r.session.tick(), "candidate").map((c) => c.id)).toEqual([open]);

    r.to(at(130));
    const marks = of(r.session.tick(), "candidate");
    expect(marks.find((m) => m.id === a45)).toEqual({
      id: a45,
      mmsi: 230000101,
      lat: 59.7,
      lon: expect.any(Number),
      gap_start: at(100) - 30_000,
      // Who and where, so the map can list it without asking for the case.
      name: "TEST 230000101",
      flag: "Finland",
      type_label: "cargo",
      near: { name: "Naissaar island", country: "EE", km: 26, dir: "NW" },
    });
    expect(marks.map((m) => m.id)).not.toContain(open);

    // Back at 08:25: the trigger fires and the dossier is shown.
    r.to(at(144));
    expect(of(r.session.tick(), "dossier")).toEqual([]);
    r.to(at(146));
    expect(of(r.session.tick(), "dossier")).toEqual([{ candidate_id: a45, version: 1, verdict: "likely_dark", confidence: "medium" }]);
    r.to(at(150));
    expect(of(r.session.tick(), "dossier")).toEqual([]);
  });

  test("positions: the last fix of each vessel heard from in the last 10 minutes", async () => {
    const { db } = await world();
    const r = replay(db, T0);
    r.session.open();
    const vessels = (t: number) => {
      r.to(t);
      return of(r.session.tick(), "positions")[0]!.vessels.map((v) => v[0]);
    };
    expect(vessels(at(105))).toContain(230000101);
    expect(vessels(at(111))).not.toContain(230000101);
    expect(vessels(at(146))).toContain(230000101);
  });

  test("joining late shows what is on the map already", async () => {
    const { db, a45, cases } = await world();
    const events = replay(db, at(200)).session.open();
    expect(of(events, "candidate").map((c) => c.id).sort()).toEqual(cases);
    expect(of(events, "dossier").map((d) => d.candidate_id)).toEqual([a45]);
  });

  test("when the replay starts over, the viewer is told to clear the map", async () => {
    const { db } = await world();
    const range = recordedRange(db)!;
    const r = replay(db, range.end - 120_000);
    r.session.open();
    r.to(range.end - 60_000);
    expect(of(r.session.tick(), "reset")).toEqual([]);
    r.to(range.end + 120_000);
    const events = r.session.tick();
    expect(events[0]!.event).toBe("reset");
    expect(of(events, "candidate")).toEqual([]);
  });

  test("health: one event per closed minute", async () => {
    const { db } = await world();
    const r = replay(db, at(50));
    r.session.open();
    expect(of(r.session.tick(), "health")).toEqual([{ minute: at(49), connected: true, msg_count: expect.any(Number) }]);
    expect(of(r.session.tick(), "health")).toEqual([]);
    r.to(at(51));
    expect(of(r.session.tick(), "health").map((h) => h.minute)).toEqual([at(50)]);
  });
});

describe("live stream", () => {
  test("new gaps and dossiers go out as they are written", async () => {
    const { db, a45 } = await world();
    let now = END + 60_000;
    const session = new StreamSession(db, "live", () => now);
    // Written at END: within the last 24 h, so they are on the map.
    expect(of(session.open(), "candidate").length).toBeGreaterThan(0);
    now += 1000;
    expect(of(session.tick(), "dossier")).toEqual([]);
    const { profiles } = loadConfig({});
    await investigate(db, a45, { primary: new FakeClient(script("happy")), profiles, capUsd: 0, now: () => now });
    now += 1000;
    expect(of(session.tick(), "dossier")).toEqual([{ candidate_id: a45, version: 2, verdict: "likely_dark", confidence: "medium" }]);
    now += 1000;
    expect(of(session.tick(), "dossier")).toEqual([]);
  });
});

describe("GET /api/stream", () => {
  const app = async (mode: "replay" | "live") => {
    const { db } = await world();
    return createApp({ db, config: loadConfig({}), mode });
  };

  test("an event stream that starts with hello", async () => {
    const res = await (await app("replay"))(new Request(`http://localhost/api/stream?speed=300&at=${at(200)}`));
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    await reader.cancel();
    expect(first).toStartWith("event: hello\ndata: ");
    const hello = JSON.parse(first.split("\n")[1]!.slice(6)) as { t: number };
    expect(hello).toMatchObject({ mode: "replay", speed: 300, range: { start: T0 } });
    // A few real milliseconds go by at 300×.
    expect(hello.t - at(200)).toBeWithin(0, 60_000);
  });

  test("a speed that is not offered is a 400", async () => {
    const res = await (await app("replay"))(new Request("http://localhost/api/stream?speed=7"));
    expect(res.status).toBe(400);
  });
});
