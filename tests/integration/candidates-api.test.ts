import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { investigate } from "../../src/agent/investigate";
import { FakeClient, type ScriptedReply } from "../../src/agent/model";
import { loadConfig, type Mode, type ProfileName } from "../../src/config";
import { openDb } from "../../src/db";
import { runDetector } from "../../src/detect/run";
import { createApp } from "../../src/server/app";
import { SerialInvestigator } from "../../src/server/investigator";
import type { CandidateDetail, CandidateList, Reinvestigation } from "../../src/shared/api";
import { END, PORTS, play, T0 } from "../fixtures/ais/gaps";

// GET /api/candidates, GET /api/candidates/:id and POST …/reinvestigate (T034), on the synthetic
// tracks with two cases investigated by scripted models: the 45-minute class A gap (230000101)
// and the anchorage off Kotka (230000108), escalated to Haiku.

const script = (name: string): ScriptedReply[] =>
  (JSON.parse(readFileSync(join(import.meta.dir, "../fixtures/scripts", `${name}.json`), "utf8")) as { replies: ScriptedReply[] }).replies;

type Db = ReturnType<typeof openDb>;

/** `gate`: the queued investigations wait for it before they start. */
async function world(env: Record<string, string> = {}, gate: Promise<void> = Promise.resolve()) {
  const db = openDb(":memory:");
  play(db, T0, END);
  runDetector(db, END, { ports: PORTS });
  const config = loadConfig(env);
  const id = (mmsi: number) => db.query<{ id: number }, [number]>("SELECT id FROM candidates WHERE mmsi = ?").get(mmsi)!.id;
  const a45 = id(230000101);
  const anchor = id(230000108);
  const deps = { profiles: config.profiles, capUsd: 10, now: () => END };
  await investigate(db, a45, { ...deps, primary: new FakeClient(script("happy")) });
  await investigate(db, anchor, { ...deps, primary: new FakeClient(script("inconclusive")), escalate: new FakeClient(script("escalated"), "haiku") });
  const investigator = new SerialInvestigator(db, config, (p) => {
    const client = new FakeClient(script("happy"), p.name);
    client.unavailable = () => gate.then(() => null);
    return client;
  });
  const call = async (path: string, init: RequestInit & { as?: Mode } = {}) => {
    const handler = createApp({ db, config, mode: init.as ?? "live", investigator });
    return handler(new Request(`http://localhost${path}`, init));
  };
  return { db, config, investigator, call, ids: { a45, anchor, berth: id(230000107) } };
}

const json = async <T>(res: Response | Promise<Response>) => (await (await res).json()) as T;

describe("GET /api/candidates", () => {
  test("lists the cases newest first, with their latest verdict, and leaves the discarded out", async () => {
    const { call, ids } = await world();
    const list = await json<CandidateList>(call("/api/candidates"));
    expect(list.items.every((c) => c.state !== "discarded")).toBe(true);
    expect(list.items.map((c) => c.gap_start)).toEqual([...list.items.map((c) => c.gap_start)].sort((a, b) => b - a));
    const a45 = list.items.find((c) => c.id === ids.a45)!;
    expect(a45).toMatchObject({
      state: "investigated",
      ais_class: "A",
      // The last fix is half a minute before the silence: 45.5 minutes.
      duration_min: 46,
      dossier: { version: 1, verdict: "likely_dark", confidence: "medium", profile: "local", escalated: false, cost_usd: 0 },
    });
    expect(list.items.find((c) => c.id === ids.anchor)!.dossier).toMatchObject({ profile: "haiku", escalated: true });
    expect(list.items.find((c) => c.dossier === null && c.gap_end === null)).toMatchObject({ duration_min: null, end: null });
  });

  test("filters by state, verdict and date", async () => {
    const { call, ids } = await world();
    const discarded = await json<CandidateList>(call("/api/candidates?state=discarded"));
    expect(discarded.items.map((c) => c.discard_reason).sort()).toEqual(["berth", "left_region", "own_outage"]);
    const both = await json<CandidateList>(call("/api/candidates?state=pending,investigated"));
    expect(new Set(both.items.map((c) => c.state))).toEqual(new Set(["pending", "investigated"]));
    const dark = await json<CandidateList>(call("/api/candidates?verdict=likely_dark"));
    expect(dark.items.map((c) => c.id).sort()).toEqual([ids.a45, ids.anchor].sort());
    const day = new Date(T0).toISOString().slice(0, 10);
    expect((await json<CandidateList>(call(`/api/candidates?from=${day}`))).total).toBe(4);
    expect((await json<CandidateList>(call(`/api/candidates?to=${day}`))).total).toBe(0);
    const all = (await json<CandidateList>(call("/api/candidates"))).items;
    const after = await json<CandidateList>(call("/api/candidates?from=2026-10-19T07:00"));
    expect(after.items.map((c) => c.id)).toEqual(all.filter((c) => c.gap_start >= T0 + 3_600_000).map((c) => c.id));
    expect(after.total).toBeGreaterThan(0);
    expect(after.total).toBeLessThan(all.length);
  });

  test("50 per page", async () => {
    const { db, call } = await world();
    const add = db.query("INSERT INTO candidates (mmsi, gap_start, start_lat, start_lon, ais_class, state, created_at) VALUES (230000101, ?, 59.8, 25, 'A', 'pending', 0)");
    for (let i = 0; i < 60; i++) add.run(T0 - (i + 1) * 60_000);
    const one = await json<CandidateList>(call("/api/candidates"));
    const two = await json<CandidateList>(call("/api/candidates?page=2"));
    expect([one.items.length, two.items.length, one.total, one.page_size]).toEqual([50, 14, 64, 50]);
    expect(new Set([...one.items, ...two.items].map((c) => c.id)).size).toBe(64);
  });

  test("a bad filter is a 400", async () => {
    const { call } = await world();
    for (const q of ["state=sunk", "verdict=guilty", "from=yesterday", "page=0"]) {
      const res = await call(`/api/candidates?${q}`);
      expect({ q, status: res.status }).toEqual({ q, status: 400 });
      expect((await json<{ error: { code: string } }>(res)).error.code).toBe("invalid_request");
    }
  });
});

describe("GET /api/candidates/:id", () => {
  test("the candidate, the vessel, and every dossier with its evidence and its trace", async () => {
    const { call, ids } = await world();
    const d = await json<CandidateDetail>(call(`/api/candidates/${ids.anchor}`));
    expect(d.candidate).toMatchObject({ id: ids.anchor, nav_status_start: 1, name: "TEST 230000108", vessel: { flag: "Finland", type_label: "cargo" } });
    expect(d.dossiers).toHaveLength(1);
    const [dossier] = d.dossiers;
    expect(dossier!.steps.map((s) => s.idx)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(dossier!.evidence.map((e) => e.step)).toEqual([5, 6]);
    // Every piece of evidence points at a tool result in the trace.
    for (const e of dossier!.evidence) expect(dossier!.steps[e.step]).toMatchObject({ kind: "tool_call" });
    expect(dossier!.steps[0]).toMatchObject({ kind: "model_call", model: "fake-local", input_tokens: 1200 });
    expect(JSON.parse(dossier!.steps[1]!.output_json!)).toHaveProperty("positions");
  });

  test("404 for a candidate that does not exist, 400 for an id that is not one", async () => {
    const { call } = await world();
    expect((await call("/api/candidates/999")).status).toBe(404);
    expect((await call("/api/candidates/abc")).status).toBe(400);
  });
});

describe("POST /api/candidates/:id/reinvestigate", () => {
  const post = (body?: unknown, as?: Mode) => ({
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    as,
  });

  test("queues the case; the new dossier is version 2 and the first stays", async () => {
    const { call, ids, investigator } = await world();
    const res = await call(`/api/candidates/${ids.a45}/reinvestigate`, post());
    expect(res.status).toBe(202);
    expect(await json<Reinvestigation>(res)).toEqual({ queued: true, profile: "local", position: 1 });
    await investigator.idle();
    const d = await json<CandidateDetail>(call(`/api/candidates/${ids.a45}`));
    expect(d.dossiers.map((x) => x.version)).toEqual([1, 2]);
    expect(d.candidate.state).toBe("investigated");
  });

  test("a case queued twice keeps its place", async () => {
    let open = () => {};
    const { db, call, ids, investigator } = await world({}, new Promise<void>((r) => (open = r)));
    const places = [];
    for (const id of [ids.a45, ids.anchor, ids.anchor, ids.a45]) {
      places.push((await json<Reinvestigation>(call(`/api/candidates/${id}/reinvestigate`, post()))).position);
    }
    expect(places).toEqual([1, 2, 2, 1]);
    open();
    await investigator.idle();
    expect(db.query<{ n: number }, []>("SELECT count(*) AS n FROM dossiers").get()!.n).toBe(4);
  });

  test("refused: a discarded gap, a paid profile without key or over the cap, an unknown profile", async () => {
    const { call, ids } = await world();
    const code = async (id: number, body?: unknown) => {
      const res = await call(`/api/candidates/${id}/reinvestigate`, post(body));
      return [res.status, (await json<{ error: { code: string } }>(res)).error.code];
    };
    expect(await code(ids.berth)).toEqual([409, "invalid_state"]);
    expect(await code(ids.a45, { profile: "haiku" })).toEqual([409, "no_api_key"]);
    expect(await code(ids.a45, { profile: "gpt" })).toEqual([400, "invalid_request"]);
    expect(await code(999)).toEqual([404, "not_found"]);

    const paid = await world({ ANTHROPIC_API_KEY: "sk-test", VIGIA_BUDGET_USD: "0.001" });
    const res = await paid.call(`/api/candidates/${paid.ids.a45}/reinvestigate`, post({ profile: "sonnet" }));
    // The escalation in world() already spent the 0.001.
    expect([res.status, (await json<{ error: { code: string } }>(res)).error.code]).toEqual([409, "over_budget"]);
  });

  test("403 in replay and public", async () => {
    const { call, ids } = await world();
    for (const mode of ["replay", "public"] as const) {
      expect((await call(`/api/candidates/${ids.a45}/reinvestigate`, post(undefined, mode))).status).toBe(403);
    }
  });
});
