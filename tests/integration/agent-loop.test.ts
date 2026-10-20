import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { estimateTokens } from "../../src/agent/budget";
import { type InvestigateDeps, investigate } from "../../src/agent/investigate";
import { FakeClient, type ScriptedReply } from "../../src/agent/model";
import { loadConfig, type ProfileName } from "../../src/config";
import { openDb } from "../../src/db";
import { runDetector } from "../../src/detect/run";
import { END, PORTS, play, T0 } from "../fixtures/ais/gaps";

// The agent loop against scripted models (T017), on the synthetic tracks: the tools the script
// calls answer from real positions. The case is the 45-minute class A gap of vessel 230000101.

const SCRIPTS = join(import.meta.dir, "../fixtures/scripts");
const script = (name: string): ScriptedReply[] =>
  (JSON.parse(readFileSync(join(SCRIPTS, `${name}.json`), "utf8")) as { replies: ScriptedReply[] }).replies;
const fake = (name: string, profile: ProfileName = "local") => new FakeClient(script(name), profile);
// The context the PC is meant to run with; the tests of the context guard set their own.
const { profiles } = loadConfig({ VIGIA_LOCAL_CONTEXT: "16384" });
const withContext = (contextTokens: number) => ({ ...profiles, local: { ...profiles.local, contextTokens } });

type Db = ReturnType<typeof openDb>;

function setup(): { db: Db; id: number } {
  const db = openDb(":memory:");
  play(db, T0, END);
  runDetector(db, END, { ports: PORTS });
  const id = db.query<{ id: number }, []>("SELECT id FROM candidates WHERE mmsi = 230000101 AND state = 'pending'").get()!.id;
  return { db, id };
}

const deps = (d: Partial<InvestigateDeps> & Pick<InvestigateDeps, "primary">): InvestigateDeps => ({
  profiles,
  capUsd: 0,
  now: () => END,
  ...d,
});
const state = (db: Db, id: number) => db.query<{ state: string }, [number]>("SELECT state FROM candidates WHERE id = ?").get(id)?.state;
const steps = (db: Db) =>
  db.query<{ idx: number; kind: string; tool: string | null; model: string | null; input_tokens: number; output_summary: string }, []>(
    "SELECT idx, kind, tool, model, input_tokens, output_summary FROM trace_steps ORDER BY idx",
  ).all();
const dossiers = (db: Db) => db.query<Record<string, unknown>, []>("SELECT * FROM dossiers").all();

describe("agent loop", () => {
  test("(a) happy path: a dossier with evidence linked to its steps and the whole trace with tokens", async () => {
    const { db, id } = setup();
    const client = fake("happy");
    const out = await investigate(db, id, deps({ primary: client }));
    expect(out).toMatchObject({ state: "investigated", escalated: false });
    expect(state(db, id)).toBe("investigated");

    const [d] = dossiers(db);
    expect(d).toMatchObject({ version: 1, verdict: "likely_dark", profile: "local", escalated: 0, input_tokens: 3800, output_tokens: 230, cost_usd: 0 });
    expect(steps(db).map((s) => [s.idx, s.kind, s.tool])).toEqual([
      [0, "model_call", null],
      [1, "tool_call", "get_track"],
      [2, "tool_call", "get_nearby"],
      [3, "model_call", null],
      [4, "tool_call", "submit_verdict"],
    ]);
    const evidence = db.query<{ step_idx: number }, []>("SELECT step_idx FROM evidence ORDER BY step_idx").all();
    expect(evidence.map((e) => e.step_idx)).toEqual([1, 2]);

    // The tool results carry their step number, which is what the model cites.
    const results = JSON.stringify(client.calls[1]!.messages.at(-1));
    expect(results).toContain('\\"step\\":1');
    expect(results).toContain('\\"step\\":2');
    expect(steps(db)[1]!.output_summary).toContain("silence");
    expect(client.remaining).toBe(0);
  });

  test("(b) a tool that fails is in the trace as an error, and the agent goes on", async () => {
    const { db, id } = setup();
    await investigate(db, id, deps({ primary: fake("tool-fails") }));
    expect(state(db, id)).toBe("investigated");
    const failed = steps(db).find((s) => s.kind === "error")!;
    expect(failed).toMatchObject({ idx: 1, tool: "get_track" });
    expect(failed.output_summary).toContain("6 h");
  });

  test("(c) ending without submit_verdict gets one nudge, and only one", async () => {
    const ok = setup();
    await investigate(ok.db, ok.id, deps({ primary: fake("no-verdict-recovers") }));
    expect(state(ok.db, ok.id)).toBe("investigated");
    expect(steps(ok.db).filter((s) => s.kind === "nudge")).toHaveLength(1);

    const bad = setup();
    const client = fake("no-verdict-twice");
    expect(await investigate(bad.db, bad.id, deps({ primary: client }))).toMatchObject({ state: "error" });
    expect(client.calls).toHaveLength(2);
    expect(dossiers(bad.db)).toHaveLength(0);
    expect(state(bad.db, bad.id)).toBe("error");
  });

  test("(d) a verdict that does not validate three times leaves the case in error", async () => {
    const { db, id } = setup();
    const client = fake("bad-verdict");
    const out = await investigate(db, id, deps({ primary: client }));
    expect(out).toMatchObject({ state: "error" });
    expect(client.calls).toHaveLength(4);
    expect(dossiers(db)).toHaveLength(0);
    // The model was told which steps it could cite.
    expect(JSON.stringify(client.calls[2]!.messages.at(-1))).toContain("you can cite: 1");
  });

  test("(e) an 11th tool call is not run; the model must submit with what it has", async () => {
    const { db, id } = setup();
    const out = await investigate(db, id, deps({ primary: fake("tool-limit") }));
    expect(out).toMatchObject({ state: "investigated" });
    const s = steps(db);
    expect(s.filter((x) => x.kind === "tool_call" && x.tool === "get_vessel")).toHaveLength(10);
    expect(s.find((x) => x.kind === "error")).toMatchObject({ tool: "get_vessel" });

    const again = setup();
    const ignored = fake("tool-limit-ignored");
    expect(await investigate(again.db, again.id, deps({ primary: ignored }))).toMatchObject({ state: "error" });
    expect(ignored.calls).toHaveLength(12);
  });

  test("(f) inconclusive with an escalation profile and budget: a second try, both in the trace, escalated = 1", async () => {
    const { db, id } = setup();
    const escalate = fake("escalated", "haiku");
    const out = await investigate(db, id, deps({ primary: fake("inconclusive"), escalate, capUsd: 10 }));
    expect(out).toMatchObject({ state: "investigated", escalated: true });
    const [d] = dossiers(db);
    expect(d).toMatchObject({ verdict: "likely_dark", profile: "haiku", escalated: 1 });
    // 8000 tokens in and 400 out at Haiku's prices; the local steps cost nothing.
    expect(d!.cost_usd as number).toBeCloseTo(0.0008 + 0.0002, 10);
    expect(new Set(steps(db).map((s) => s.model).filter((m) => m !== null))).toEqual(new Set(["fake-local", "fake-haiku"]));
    expect(steps(db).map((s) => s.idx)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(db.query<{ spent_usd: number }, []>("SELECT spent_usd FROM budget").get()?.spent_usd).toBeCloseTo(0.001, 10);
  });

  test("(f) without budget for the escalation, the local verdict stands and the trace says why", async () => {
    const { db, id } = setup();
    const escalate = fake("escalated", "haiku");
    await investigate(db, id, deps({ primary: fake("inconclusive"), escalate, capUsd: 0 }));
    expect(escalate.calls).toHaveLength(0);
    expect(dossiers(db)[0]).toMatchObject({ verdict: "inconclusive", profile: "local", escalated: 0 });
    expect(steps(db).at(-1)!.output_summary).toContain("monthly cap");
  });

  test("(g) with the cap already reached, no call is made and the case waits in pending_budget", async () => {
    const { db, id } = setup();
    const client = fake("happy", "haiku");
    expect(await investigate(db, id, deps({ primary: client, capUsd: 0 }))).toEqual({ state: "pending_budget" });
    expect(client.calls).toHaveLength(0);
    expect(state(db, id)).toBe("pending_budget");
  });

  test("(h) a connection that drops halfway leaves no dossier, and the case waits for the model", async () => {
    const { db, id } = setup();
    expect(await investigate(db, id, deps({ primary: fake("connection-drop") }))).toMatchObject({ state: "pending_no_model" });
    expect(dossiers(db)).toHaveLength(0);
    expect(db.query("SELECT 1 FROM trace_steps").all()).toHaveLength(0);
    expect(state(db, id)).toBe("pending_no_model");
  });

  test("(i) a call whose worst case would go over the cap is not made", async () => {
    const { db, id } = setup();
    const client = fake("costly-first-call", "haiku");
    expect(await investigate(db, id, deps({ primary: client, capUsd: 0.012 }))).toEqual({ state: "pending_budget" });
    expect(client.calls).toHaveLength(1);
    // What was spent stays spent.
    expect(db.query<{ spent_usd: number }, []>("SELECT spent_usd FROM budget").get()?.spent_usd).toBeCloseTo(0.006, 10);
  });

  test("a second investigation of the same case is version 2", async () => {
    const { db, id } = setup();
    await investigate(db, id, deps({ primary: fake("happy") }));
    await investigate(db, id, deps({ primary: fake("happy") }));
    expect(dossiers(db).map((d) => d.version)).toEqual([1, 2]);
  });
});

describe("model availability", () => {
  test("(j) a conversation that would outgrow the context keeps only the summaries of its oldest tool results", async () => {
    // How big the second request is with everything in it.
    const roomy = setup();
    const full = fake("happy");
    await investigate(roomy.db, roomy.id, deps({ primary: full }));
    const size = estimateTokens(JSON.stringify(full.calls[1]));

    // One token less than that needs, with room for the reply.
    const { db, id } = setup();
    const client = fake("happy");
    const out = await investigate(db, id, deps({ primary: client, profiles: withContext(size + 1024 - 1) }));
    expect(out).toMatchObject({ state: "investigated" });
    const sent = JSON.stringify(client.calls[1]!.messages.at(-1));
    // The first result (get_track, step 1) lost its data and kept its step and summary; the second is whole.
    expect(sent).toContain('\\"step\\":1,\\"summary\\"');
    expect(sent).toContain("data dropped to fit the model's context");
    expect(sent).toContain('\\"step\\":2,\\"summary\\"');
    expect(sent.match(/data dropped/g)).toHaveLength(1);
    // The model call says so in its trace, and the evidence still links to step 1.
    const call = db.query<{ input_json: string }, []>("SELECT input_json FROM trace_steps WHERE idx = 3").get()!;
    expect(JSON.parse(call.input_json)).toMatchObject({ trimmed_results: 1 });
    expect(db.query<{ step_idx: number }, []>("SELECT step_idx FROM evidence ORDER BY step_idx").all().map((e) => e.step_idx)).toEqual([1, 2]);
  });

  test("(j) if even the summaries do not fit, no call is made and the case ends in error, saying why", async () => {
    const { db, id } = setup();
    const client = fake("happy");
    const out = await investigate(db, id, deps({ primary: client, profiles: withContext(2048) }));
    expect(out).toEqual({ state: "error", reason: "the investigation does not fit the model's context of 2048 tokens, even with only the summaries of its tool results" });
    expect(client.calls).toHaveLength(0);
    expect(state(db, id)).toBe("error");
  });

  test("with the model unreachable, no call is made and the case waits in pending_no_model", async () => {
    const { db, id } = setup();
    const client = fake("happy");
    client.down = "Ollama did not answer";
    expect(await investigate(db, id, deps({ primary: client }))).toEqual({ state: "pending_no_model", reason: "Ollama did not answer" });
    expect(client.calls).toHaveLength(0);
    expect(state(db, id)).toBe("pending_no_model");
  });
});
