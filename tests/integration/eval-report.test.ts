import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { agentVersion, investigate } from "../../src/agent/investigate";
import { FakeClient, type ScriptedReply } from "../../src/agent/model";
import { loadConfig } from "../../src/config";
import { openDb } from "../../src/db";
import { runDetector } from "../../src/detect/run";
import { buildReport, listReports, saveReport } from "../../src/eval/report";
import { investigateLabeled } from "../../src/eval/run";
import { createApp } from "../../src/server/app";
import type { EvalReports, LabelValue } from "../../src/shared/api";
import { END, PORTS, play, T0 } from "../fixtures/ais/gaps";

// The eval report (T052, T055) on the four cases of the synthetic tracks, labelled by hand:
//   230000109 open for 6 h     likely_dark     no dossier          rule: dark (open)
//   230000101 45 min           likely_dark     local: likely_dark  rule: not dark
//   230000104 class B, 70 min  coverage_gap    no dossier          rule: dark
//   230000108 anchored, 50 min undeterminable  haiku (escalated)   rule: not dark

const script = (name: string): ScriptedReply[] =>
  (JSON.parse(readFileSync(join(import.meta.dir, "../fixtures/scripts", `${name}.json`), "utf8")) as { replies: ScriptedReply[] }).replies;
const { profiles } = loadConfig({});

async function world() {
  const db = openDb(":memory:");
  play(db, T0, END);
  runDetector(db, END, { ports: PORTS });
  const id = (mmsi: number) => db.query<{ id: number }, [number]>("SELECT id FROM candidates WHERE mmsi = ?").get(mmsi)!.id;
  await investigate(db, id(230000101), { primary: new FakeClient(script("happy")), profiles, capUsd: 0, now: () => END });
  await investigate(db, id(230000108), {
    primary: new FakeClient(script("inconclusive")),
    escalate: new FakeClient(script("escalated"), "haiku"),
    profiles,
    capUsd: 1,
    now: () => END,
  });
  const label = (mmsi: number, value: LabelValue) =>
    db.query("INSERT INTO labels (candidate_id, value, author, created_at) VALUES (?, ?, 'test', 0)").run(id(mmsi), value);
  label(230000109, "likely_dark");
  label(230000101, "likely_dark");
  label(230000104, "coverage_gap");
  label(230000108, "undeterminable");
  return { db, id };
}

describe("eval report", () => {
  test("the agent over the cases it has a dossier for, the rule over all of them", async () => {
    const { db } = await world();
    const r = buildReport(db, { now: END });
    expect(r).toMatchObject({ profile: null, n_labeled: 4, n_positive: 2, n_undeterminable: 1, stopping_rule_met: false });
    expect(r.metrics.agent).toMatchObject({ tp: 1, fp: 0, fn: 0, tn: 0, undeterminable: 1 });
    expect(r.metrics.agent.precision).toMatchObject({ p: 1 });
    expect(r.metrics.naive).toMatchObject({ tp: 1, fp: 1, fn: 1, tn: 0, undeterminable: 1 });
    expect(r.metrics.naive.recall!.p).toBe(0.5);
    expect(r.metrics.not_investigated).toBe(2);
    expect(r.metrics.stopping).toEqual({ met: false, status: "insufficient", missing_cases: 96, missing_positives: 13 });
    // Over the labelled period: the berth gap is in it, our outage came before the first case.
    expect(r.metrics.discarded).toMatchObject({ berth: 1, own_outage: 0 });
  });

  test("cost per case and per profile; one agent version per kind of dossier", async () => {
    const { db } = await world();
    const r = buildReport(db, { now: END });
    expect(r.metrics.cost.by_profile.local).toEqual({ cases: 1, mean_usd: 0 });
    expect(r.metrics.cost.by_profile.haiku!.mean_usd).toBeCloseTo(0.001, 10);
    expect(r.metrics.cost.mean_usd_per_case).toBeCloseTo(0.0005, 10);
    expect(r.agent_version.split(",")).toHaveLength(2);
  });

  test("the rule gives the same figures every time (SC-003)", async () => {
    const { db } = await world();
    expect(buildReport(db, { now: END }).metrics.naive).toEqual(buildReport(db, { now: END + 1 }).metrics.naive);
  });

  test("saved, listed newest first, and served by GET /api/eval/reports", async () => {
    const { db } = await world();
    const first = saveReport(db, buildReport(db, { now: END }));
    const second = saveReport(db, buildReport(db, { now: END + 60_000 }));
    expect(listReports(db).map((r) => r.id)).toEqual([second, first]);
    const res = await createApp({ db, config: loadConfig({}), mode: "public" })(new Request("http://localhost/api/eval/reports"));
    const body = (await res.json()) as EvalReports;
    expect(body.items[0]).toMatchObject({ id: second, stopping_rule_met: false, metrics: { agent: { tp: 1 } } });
  });
});

describe("eval --profile", () => {
  const happyTimes = (n: number) => Array.from({ length: n }, () => script("happy")).flat();

  test("investigates every labelled case with that profile alone, and the report only takes those dossiers", async () => {
    const { db } = await world();
    const client = new FakeClient(happyTimes(4));
    const run = await investigateLabeled(db, { client, profiles, capUsd: 0, now: () => END });
    // 230000101 already had a dossier of this exact version.
    expect(run).toEqual({ agentVersion: agentVersion(client), investigated: 3, reused: 1, errors: 0, stopped: null });
    const r = buildReport(db, { profile: { name: "local", agentVersion: run.agentVersion }, now: END });
    expect(r).toMatchObject({ profile: "local", agent_version: run.agentVersion });
    expect(r.metrics.not_investigated).toBe(0);
    // The happy script says likely_dark every time.
    expect(r.metrics.agent).toMatchObject({ tp: 2, fp: 1, fn: 0, tn: 0, undeterminable: 1 });
    expect(r.metrics.cost.by_profile).toEqual({ local: { cases: 4, mean_usd: 0 } });
  });

  test("asks nothing again on a second run, unless told to", async () => {
    const { db } = await world();
    await investigateLabeled(db, { client: new FakeClient(happyTimes(3)), profiles, capUsd: 0, now: () => END });
    const again = new FakeClient([]);
    expect(await investigateLabeled(db, { client: again, profiles, capUsd: 0, now: () => END })).toMatchObject({ investigated: 0, reused: 4 });
    expect(again.calls).toHaveLength(0);
    const fresh = new FakeClient(happyTimes(4));
    expect(await investigateLabeled(db, { client: fresh, profiles, capUsd: 0, fresh: true, now: () => END })).toMatchObject({ investigated: 4 });
  });

  test("stops at the cap, and when the model does not answer", async () => {
    const { db } = await world();
    const paid = new FakeClient(happyTimes(4), "haiku");
    const run = await investigateLabeled(db, { client: paid, profiles, capUsd: 0, now: () => END });
    expect(run).toMatchObject({ investigated: 0, stopped: "the monthly cap would be exceeded" });
    expect(paid.calls).toHaveLength(0);

    const down = new FakeClient([]);
    down.down = "Ollama did not answer";
    expect((await investigateLabeled(db, { client: down, profiles, capUsd: 0, fresh: true, now: () => END })).stopped).toBe(
      "the model does not answer (Ollama did not answer)",
    );
  });
});
