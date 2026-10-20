import { describe, expect, test } from "bun:test";
import { loadConfig } from "../../src/config";
import { openDb } from "../../src/db";
import { createApp } from "../../src/server/app";
import type { HealthReport } from "../../src/shared/api";
import { at, END, OUTAGE, play, T0 } from "../fixtures/ais/gaps";

// GET /api/health (T063) over the synthetic tracks, whose ingest is down from minute 20 to 35.

function app() {
  const db = openDb(":memory:");
  play(db, T0, END);
  const handler = createApp({ db, config: loadConfig({}), mode: "public" });
  return async (query = "") => {
    const res = await handler(new Request(`http://localhost/api/health${query}`));
    return { status: res.status, body: (await res.json()) as HealthReport };
  };
}

describe("GET /api/health", () => {
  test("by default, the last day closed: every minute, and our outage", async () => {
    const { status, body } = await app()();
    expect(status).toBe(200);
    expect(body).toMatchObject({ from: END - 24 * 3_600_000, to: END, closed_until: END, outage_after_min: 2 });
    expect(body.minutes).toHaveLength(450);
    expect(body.minutes[0]).toEqual([T0, expect.any(Number), 1]);
    expect(body.outages).toEqual([{ start_ts: at(OUTAGE[0]), end_ts: at(OUTAGE[1]), cause: "no_messages" }]);
    expect(body.totals).toMatchObject({ minutes: 450, down: OUTAGE[1] - OUTAGE[0] });
    expect(body.totals.messages).toBe(body.minutes.reduce((s, m) => s + m[1], 0));
  });

  test("a window: only its minutes, and the outages that overlap it", async () => {
    const call = app();
    const iso = (t: number) => new Date(t).toISOString();
    const before = await call(`?from=${iso(at(0))}&to=${iso(at(10))}`);
    expect(before.body.minutes.map((m) => m[0])).toEqual(Array.from({ length: 10 }, (_, i) => at(i)));
    expect(before.body.outages).toEqual([]);
    const inside = await call(`?from=${iso(at(25))}&to=${iso(at(30))}`);
    expect(inside.body.outages).toHaveLength(1);
    expect(inside.body.minutes.every(([, n]) => n === 0)).toBe(true);
  });

  test("refuses an empty or reversed window, more than 7 days, and a bad date", async () => {
    const call = app();
    expect((await call("?from=2026-10-19T10:00&to=2026-10-19T09:00")).status).toBe(400);
    expect((await call("?from=2026-10-01&to=2026-10-19")).status).toBe(400);
    expect((await call("?from=yesterday")).status).toBe(400);
  });
});
