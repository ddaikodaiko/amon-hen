import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { investigate } from "../../src/agent/investigate";
import { FakeClient, type ScriptedReply } from "../../src/agent/model";
import { loadConfig } from "../../src/config";
import { openDb } from "../../src/db";
import { runDetector } from "../../src/detect/run";
import { briefForModel, writeNarrative } from "../../src/brief/narrative";
import { generateBrief, rank, readBrief } from "../../src/brief/sections";
import { createApp } from "../../src/server/app";
import type { Brief, BriefCase, BriefList } from "../../src/shared/api";
import { END, OUTAGE, PORTS, play, T0 } from "../fixtures/ais/gaps";

// The daily brief (T066, T068) over the synthetic tracks, with three cases investigated at END
// (2026-10-19 13:30 UTC): 230000101 likely dark, 230000104 coverage gap, 230000108 inconclusive.
// 230000109 is left waiting. The brief of 2026-10-20 covers 19 Oct 08:00 to 20 Oct 08:00, Madrid.

const script = (name: string): ScriptedReply[] =>
  (JSON.parse(readFileSync(join(import.meta.dir, "../fixtures/scripts", `${name}.json`), "utf8")) as { replies: ScriptedReply[] }).replies;
const DATE = "2026-10-20";

async function world(env: Record<string, string> = {}) {
  const db = openDb(":memory:");
  play(db, T0, END);
  runDetector(db, END, { ports: PORTS });
  const config = loadConfig(env);
  const id = (mmsi: number) => db.query<{ id: number }, [number]>("SELECT id FROM candidates WHERE mmsi = ?").get(mmsi)!.id;
  const run = (mmsi: number, name: string) =>
    investigate(db, id(mmsi), { primary: new FakeClient(script(name)), profiles: config.profiles, capUsd: 0, now: () => END });
  await run(230000101, "happy");
  await run(230000104, "tool-fails");
  await run(230000108, "inconclusive");
  return { db, config, id };
}

const reply = (text: string): ScriptedReply[] => [{ content: [{ type: "text", text }], usage: { input_tokens: 900, output_tokens: 120 } }];

describe("brief sections", () => {
  test("the counts by verdict match the dossiers of the window", async () => {
    const { db, config } = await world();
    const b = generateBrief(db, config, DATE, END);
    expect(b.sections.window).toEqual({ start: Date.UTC(2026, 9, 19, 6), end: Date.UTC(2026, 9, 20, 6) });
    expect(b.sections.verdicts).toEqual({ cases: 3, likely_dark: 1, coverage_gap: 1, inconclusive: 1 });
    const byVerdict = db.query("SELECT verdict, count(*) AS n FROM dossiers GROUP BY verdict ORDER BY verdict").all();
    expect(byVerdict).toEqual([
      { verdict: "coverage_gap", n: 1 },
      { verdict: "inconclusive", n: 1 },
      { verdict: "likely_dark", n: 1 },
    ]);
    expect(b.sections.waiting).toEqual({ pending: 1, pending_no_model: 0, pending_budget: 0, error: 0 });
    expect(b.sections.discarded).toEqual({ own_outage: 1, left_region: 1, berth: 1 });
    expect(b.sections.health).toMatchObject({ minutes: 450, down: OUTAGE[1] - OUTAGE[0], outages: [expect.objectContaining({ cause: "no_messages" })] });
    expect(b.sections.spend).toEqual({ day_usd: 0, month_usd: 0, cap_usd: 0 });
    expect(b.narrative_state).toBe("pending");
  });

  test("the top cases are cases that exist, likely dark first", async () => {
    const { db, config, id } = await world();
    const { top } = generateBrief(db, config, DATE, END).sections;
    expect(top.map((c) => c.verdict)).toEqual(["likely_dark", "inconclusive", "coverage_gap"]);
    for (const c of top) expect(db.query("SELECT 1 FROM candidates WHERE id = ? AND mmsi = ?").get(c.id, c.mmsi)).not.toBeNull();
    expect(top[0]).toMatchObject({ id: id(230000101), name: "TEST 230000101", flag: "Finland", confidence: "medium", duration_min: 46 });
  });

  test("ranking: verdict, then confidence, then the longest gap, an open one first", () => {
    const c = (verdict: BriefCase["verdict"], confidence: BriefCase["confidence"], duration_min: number | null, id: number): BriefCase => ({
      id,
      mmsi: 230000000 + id,
      name: null,
      flag: null,
      verdict,
      confidence,
      gap_start: id,
      duration_min,
    });
    const cases = [
      c("coverage_gap", "high", 600, 1),
      c("likely_dark", "medium", 300, 2),
      c("likely_dark", "high", 40, 3),
      c("inconclusive", "low", 90, 4),
      c("likely_dark", "medium", null, 5),
      c("likely_dark", "medium", 50, 6),
    ];
    expect([...cases].sort(rank).map((x) => x.id)).toEqual([3, 5, 2, 6, 4, 1]);
  });

  test("a day without cases says so, and has no paragraph to wait for", async () => {
    const { db, config } = await world();
    const b = generateBrief(db, config, "2026-10-23", END);
    expect(b.sections.verdicts).toEqual({ cases: 0, likely_dark: 0, coverage_gap: 0, inconclusive: 0 });
    expect(b.sections.top).toEqual([]);
    expect(b.narrative_state).toBe("skipped");
    expect(b.sections.health.minutes).toBe(0);
  });

  test("written again, it replaces the day's brief", async () => {
    const { db, config } = await world();
    generateBrief(db, config, DATE, END);
    generateBrief(db, config, DATE, END + 1000);
    expect(db.query("SELECT date, generated_at FROM briefs").all()).toEqual([{ date: DATE, generated_at: END + 1000 }]);
  });
});

describe("brief narrative", () => {
  test("the model writes the paragraph from the sections, without tools", async () => {
    const { db, config } = await world();
    generateBrief(db, config, DATE, END);
    const client = new FakeClient(reply("  One vessel, TEST 230000101, likely went dark for 46 minutes.  "));
    const out = await writeNarrative(db, DATE, { client, profile: config.profiles.local, capUsd: 0, now: () => END });
    expect(out).toEqual({ state: "done", text: "One vessel, TEST 230000101, likely went dark for 46 minutes.", cost_usd: 0 });
    expect(readBrief(db, DATE)).toMatchObject({ narrative_state: "done", narrative: "One vessel, TEST 230000101, likely went dark for 46 minutes." });
    expect(client.calls[0]!.tools).toBeUndefined();
    expect(JSON.stringify(client.calls[0]!.messages)).toContain("TEST 230000101");
    // Done once: a second try asks nothing.
    const again = new FakeClient([]);
    expect(await writeNarrative(db, DATE, { client: again, profile: config.profiles.local, capUsd: 0 })).toEqual({ state: "not_pending" });
    expect(again.calls).toHaveLength(0);
  });

  test("with the model away it stays pending; a paid one is charged to the month", async () => {
    const { db, config } = await world({ ANTHROPIC_API_KEY: "sk-test" });
    generateBrief(db, config, DATE, END);
    const down = new FakeClient([]);
    down.down = "the PC is off";
    expect(await writeNarrative(db, DATE, { client: down, profile: config.profiles.local, capUsd: 0 })).toEqual({ state: "no_model", reason: "the PC is off" });
    expect(readBrief(db, DATE)?.narrative_state).toBe("pending");

    const haiku = config.profiles.haiku;
    expect(await writeNarrative(db, DATE, { client: new FakeClient(reply("x"), "haiku"), profile: haiku, capUsd: 0, now: () => END })).toEqual({ state: "over_budget" });
    const out = await writeNarrative(db, DATE, { client: new FakeClient(reply("Quiet day."), "haiku"), profile: haiku, capUsd: 1, now: () => END });
    expect(out).toMatchObject({ state: "done" });
    expect(db.query<{ spent_usd: number }, []>("SELECT spent_usd FROM budget").get()!.spent_usd).toBeCloseTo((900 * 0.1 + 120 * 0.5) / 1e6, 12);
  });

  test("a day with nothing to tell is not sent to the model", async () => {
    const { db, config } = await world();
    generateBrief(db, config, "2026-10-23", END);
    const client = new FakeClient([]);
    expect(await writeNarrative(db, "2026-10-23", { client, profile: config.profiles.local, capUsd: 0 })).toEqual({ state: "not_pending" });
  });

  test("what the model reads: times in words, the top cases, no ids", async () => {
    const { db, config } = await world();
    const s = generateBrief(db, config, DATE, END).sections;
    const text = briefForModel(s);
    expect(text).toContain('"from_utc": "2026-10-19 06:00"');
    expect(text).toContain('"vessel": "TEST 230000101"');
    expect(text).not.toContain('"id"');
  });
});

describe("GET /api/briefs", () => {
  test("the list, newest first, and each brief by its date", async () => {
    const { db, config } = await world();
    generateBrief(db, config, DATE, END);
    generateBrief(db, config, "2026-10-21", END);
    const app = createApp({ db, config, mode: "public" });
    const get = async (path: string) => {
      const res = await app(new Request(`http://localhost${path}`));
      return { status: res.status, body: (await res.json()) as unknown };
    };
    const list = (await get("/api/briefs")).body as BriefList;
    expect(list.items.map((b) => [b.date, b.verdicts.cases, b.narrative_state])).toEqual([
      ["2026-10-21", 0, "skipped"],
      [DATE, 3, "pending"],
    ]);
    const one = await get(`/api/briefs/${DATE}`);
    expect(one.status).toBe(200);
    expect((one.body as Brief).sections.top).toHaveLength(3);
    expect((await get("/api/briefs/2026-01-01")).status).toBe(404);
    expect((await get("/api/briefs/yesterday")).status).toBe(400);
  });
});
