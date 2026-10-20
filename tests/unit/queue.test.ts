import { describe, expect, test } from "bun:test";
import {
  type CandidateState,
  canTransition,
  queued,
  recoverInterrupted,
  retrigger,
  STALE_MS,
  STATES,
  TransitionError,
  transition,
  waiting,
} from "../../src/agent/queue";
import { openDb } from "../../src/db";

const T0 = Date.UTC(2026, 9, 20, 9, 0);

function candidate(db: ReturnType<typeof openDb>, state: CandidateState, trigger: number | null = null, started: number | null = null): number {
  db.query("INSERT OR IGNORE INTO vessels (mmsi, flag_mid, updated_at) VALUES (230000001, 230, 0)").run();
  return db
    .query<{ id: number }, [string, number | null, number | null]>(
      `INSERT INTO candidates (mmsi, gap_start, start_lat, start_lon, ais_class, state, trigger_at, started_at, created_at)
       VALUES (230000001, 0, 59.8, 25.0, 'A', ?, ?, ?, 0) RETURNING id`,
    )
    .get(state, trigger, started)!.id;
}

const times = (db: ReturnType<typeof openDb>, id: number) =>
  db.query<{ trigger_at: number | null; started_at: number | null }, [number]>("SELECT trigger_at, started_at FROM candidates WHERE id = ?").get(id);

describe("candidate states", () => {
  test("the transitions of the diagram are allowed", () => {
    const ok: [CandidateState, CandidateState][] = [
      ["detected", "discarded"],
      ["detected", "pending"],
      ["pending", "investigating"],
      ["pending", "pending_no_model"],
      ["investigating", "investigated"],
      ["investigating", "error"],
      ["investigating", "pending_no_model"],
      ["investigating", "pending_budget"],
      ["error", "investigating"],
      ["pending_no_model", "investigating"],
      ["pending_budget", "investigating"],
      ["investigated", "investigating"],
    ];
    for (const [from, to] of ok) expect({ from, to, ok: canTransition(from, to) }).toEqual({ from, to, ok: true });
  });

  test("and nothing else", () => {
    const allowed = 12;
    const all = STATES.flatMap((from) => STATES.map((to) => canTransition(from, to)));
    expect(all.filter(Boolean)).toHaveLength(allowed);
    expect(canTransition("discarded", "pending")).toBe(false);
    expect(canTransition("pending", "investigated")).toBe(false);
    expect(canTransition("investigated", "pending")).toBe(false);
  });

  test("a refused transition throws and changes nothing", () => {
    const db = openDb(":memory:");
    const id = candidate(db, "pending");
    expect(() => transition(db, id, "investigated")).toThrow(TransitionError);
    expect(db.query<{ state: string }, [number]>("SELECT state FROM candidates WHERE id = ?").get(id)?.state).toBe("pending");
  });

  test("entering investigating writes started_at; the place in the queue, trigger_at, stays", () => {
    const db = openDb(":memory:");
    const id = candidate(db, "pending", T0 - 1000);
    transition(db, id, "investigating", T0);
    transition(db, id, "pending_no_model", T0 + 5000);
    transition(db, id, "investigating", T0 + 60_000);
    expect(times(db, id)).toEqual({ trigger_at: T0 - 1000, started_at: T0 + 60_000 });
  });

  test("waiting cases come oldest trigger first", () => {
    const db = openDb(":memory:");
    const late = candidate(db, "pending", T0 + 2000);
    const early = candidate(db, "pending_no_model", T0);
    const mid = candidate(db, "pending_budget", T0 + 1000);
    candidate(db, "investigated", T0 - 5000);
    candidate(db, "error", T0 - 5000);
    expect(waiting(db)).toEqual([early, mid, late]);
    expect(waiting(db, ["pending"])).toEqual([late]);
  });
});

describe("the live queue", () => {
  test("waiting cases and reappeared ones, in order of arrival; not the ones waiting for budget", () => {
    const db = openDb(":memory:");
    const late = candidate(db, "pending", T0 + 3000);
    const early = candidate(db, "pending_no_model", T0, T0 + 9000);
    const reappeared = candidate(db, "investigated", T0 + 2000, T0 + 1000);
    candidate(db, "investigated", T0 + 1000, T0 + 2000);
    candidate(db, "pending_budget", T0 - 5000, T0 - 4000);
    candidate(db, "error", T0 - 5000, T0 - 4000);
    candidate(db, "investigating", T0 - 5000, T0);
    expect(queued(db)).toEqual([early, reappeared, late]);
  });

  test("a new trigger puts an investigated case back in the queue, once", () => {
    const db = openDb(":memory:");
    const id = candidate(db, "investigated", T0, T0);
    expect(queued(db)).toEqual([]);
    retrigger(db, id, T0 + 60_000);
    expect(queued(db)).toEqual([id]);
    transition(db, id, "investigating", T0 + 61_000);
    transition(db, id, "investigated", T0 + 90_000);
    expect(queued(db)).toEqual([]);
  });
});

describe("recovering cut-off investigations", () => {
  test("only cases investigating for longer than an investigation can take go back to the queue", () => {
    const db = openDb(":memory:");
    // Both entered the queue long ago; what counts is when the attempt began.
    const stale = candidate(db, "investigating", T0 - 3_600_000, T0 - STALE_MS - 1);
    const fresh = candidate(db, "investigating", T0 - 3_600_000, T0 - 60_000);
    expect(recoverInterrupted(db, T0)).toBe(1);
    const st = (id: number) => db.query<{ state: string }, [number]>("SELECT state FROM candidates WHERE id = ?").get(id)?.state;
    expect([st(stale), st(fresh)]).toEqual(["pending_no_model", "investigating"]);
  });
});
