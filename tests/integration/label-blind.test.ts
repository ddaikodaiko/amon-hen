import { describe, expect, test } from "bun:test";
import { userInfo } from "node:os";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { investigate } from "../../src/agent/investigate";
import { FakeClient, type ScriptedReply } from "../../src/agent/model";
import { loadConfig, type Mode } from "../../src/config";
import { openDb } from "../../src/db";
import { runDetector } from "../../src/detect/run";
import { createApp } from "../../src/server/app";
import type { LabelNext, LabelSaved, LabelValue } from "../../src/shared/api";
import { END, PORTS, play, T0 } from "../fixtures/ais/gaps";

// Blind labelling (T051): GET /api/label/next and POST /api/labels on the synthetic tracks, with
// the 45-minute gap (230000101) investigated, so there is a verdict that must not leak.

const script = (name: string): ScriptedReply[] =>
  (JSON.parse(readFileSync(join(import.meta.dir, "../fixtures/scripts", `${name}.json`), "utf8")) as { replies: ScriptedReply[] }).replies;

async function world() {
  const db = openDb(":memory:");
  play(db, T0, END);
  runDetector(db, END, { ports: PORTS });
  const config = loadConfig({});
  const id = (mmsi: number) => db.query<{ id: number }, [number]>("SELECT id FROM candidates WHERE mmsi = ?").get(mmsi)!.id;
  await investigate(db, id(230000101), { primary: new FakeClient(script("happy")), profiles: config.profiles, capUsd: 0, now: () => END });
  const call = async (path: string, init: RequestInit & { as?: Mode } = {}) =>
    createApp({ db, config, mode: init.as ?? "live" })(new Request(`http://localhost${path}`, init));
  const post = (body: unknown, as?: Mode) =>
    call("/api/labels", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" }, as });
  return { db, call, post, id };
}

const json = async <T>(res: Response | Promise<Response>) => (await (await res).json()) as T;

/** Every key anywhere in a JSON value. */
const keys = (v: unknown): string[] =>
  Array.isArray(v) ? v.flatMap(keys) : v !== null && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...keys(x)]) : [];

describe("GET /api/label/next", () => {
  test("carries nothing the agent said: no verdict, no dossier, not even the state", async () => {
    const { call, post, id } = await world();
    // Label until the investigated case is the one offered.
    for (;;) {
      const next = await json<LabelNext>(call("/api/label/next"));
      if (next.case!.id === id(230000101)) {
        expect(keys(next)).not.toContainAnyValues(["verdict", "confidence", "explanation", "dossier", "dossiers", "state", "profile", "escalated", "evidence", "steps"]);
        expect(JSON.stringify(next)).not.toMatch(/likely_dark|coverage_gap|inconclusive|investigated/);
        expect(next.case).toMatchObject({ mmsi: 230000101, duration_min: 46, vessel: { flag: "Finland", ais_class: "A" } });
        // The track around the gap: before it and after it.
        const ts = next.case!.track.map((p) => p[0]);
        expect(ts.some((t) => t < next.case!.gap_start) && ts.some((t) => t > next.case!.gap_end!)).toBe(true);
        return;
      }
      await post({ candidate_id: next.case!.id, value: "undeterminable" });
    }
  });

  test("goes in the order the gaps started, and skips the discarded ones", async () => {
    const { db, call, post } = await world();
    const offered: number[] = [];
    for (;;) {
      const next = await json<LabelNext>(call("/api/label/next"));
      if (next.case === null) {
        expect(next.progress).toMatchObject({ labeled: offered.length, remaining: 0 });
        break;
      }
      offered.push(next.case.id);
      expect((await post({ candidate_id: next.case.id, value: "coverage_gap" })).status).toBe(201);
    }
    const sample = db
      .query<{ id: number }, []>("SELECT id FROM candidates WHERE state NOT IN ('detected', 'discarded') ORDER BY gap_start, id")
      .all()
      .map((c) => c.id);
    expect(offered).toEqual(sample);
    expect(offered).toHaveLength(4);
    const discarded = db.query<{ id: number }, []>("SELECT id FROM candidates WHERE state = 'discarded'").all();
    expect(discarded.length).toBe(3);
    for (const d of discarded) expect(offered).not.toContain(d.id);
  });
});

describe("POST /api/labels", () => {
  test("saves the label under the system user and gives the verdict back", async () => {
    const { db, post, id } = await world();
    const res = await post({ candidate_id: id(230000101), value: "likely_dark", note: "  went quiet heading for Tallinn  " });
    expect(res.status).toBe(201);
    const saved = (await res.json()) as LabelSaved;
    expect(saved.label).toMatchObject({ value: "likely_dark", note: "went quiet heading for Tallinn", author: userInfo().username });
    expect(saved.dossier).toMatchObject({ version: 1, verdict: "likely_dark", confidence: "medium", profile: "local" });
    expect(saved.progress).toMatchObject({ labeled: 1, positives: 1, remaining: 3, stopping: { met: false, missing_cases: 99, missing_positives: 14 } });
    expect(db.query("SELECT value, note FROM labels").all()).toEqual([{ value: "likely_dark", note: "went quiet heading for Tallinn" }]);
  });

  test("a case nobody investigated comes back with no dossier; an empty note is no note", async () => {
    const { post, id } = await world();
    const saved = await json<LabelSaved>(post({ candidate_id: id(230000104), value: "coverage_gap", note: " " }));
    expect(saved.dossier).toBeNull();
    expect(saved.label.note).toBeNull();
  });

  test("refuses a second label, a discarded case, an unknown one, a bad value, and replay", async () => {
    const { post, id } = await world();
    const a45 = id(230000101);
    expect((await post({ candidate_id: a45, value: "likely_dark" })).status).toBe(201);
    const code = async (body: unknown, as?: Mode) => {
      const res = await post(body, as);
      return [res.status, ((await res.json()) as { error: { code: string } }).error.code];
    };
    expect(await code({ candidate_id: a45, value: "coverage_gap" })).toEqual([409, "already_labeled"]);
    expect(await code({ candidate_id: id(230000107), value: "coverage_gap" })).toEqual([409, "invalid_state"]);
    expect(await code({ candidate_id: 99999, value: "coverage_gap" })).toEqual([404, "not_found"]);
    expect(await code({ candidate_id: id(230000108), value: "dark" as LabelValue })).toEqual([400, "invalid_request"]);
    expect(await code({ candidate_id: id(230000108), value: "coverage_gap" }, "replay")).toEqual([403, "read_only"]);
  });
});
