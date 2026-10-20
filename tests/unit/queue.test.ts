import { describe, expect, test } from "bun:test";
import {
  type CandidateState,
  canTransition,
  recoverInterrupted,
  STALE_MS,
  STATES,
  TransitionError,
  transition,
  waiting,
} from "../../src/agent/queue";
import { openDb } from "../../src/db";

const T0 = Date.UTC(2026, 9, 20, 9, 0);

function candidate(db: ReturnType<typeof openDb>, state: CandidateState, trigger: number | null = null): number {
  db.query("INSERT OR IGNORE INTO vessels (mmsi, flag_mid, updated_at) VALUES (230000001, 230, 0)").run();
  return db
    .query<{ id: number }, [string, number | null]>(
      `INSERT INTO candidates (mmsi, gap_start, start_lat, start_lon, ais_class, state, trigger_at, created_at)
       VALUES (230000001, 0, 59.8, 25.0, 'A', ?, ?, 0) RETURNING id`,
    )
    .get(state, trigger)!.id;
}

describe("candidate states", () => {
  test("the transitions of the diagram are allowed", () => {
    const ok: [CandidateState, CandidateState][] = [
      ["detected", "discarded"],
      ["detected", "pending"],
      ["pending", "investigating"],
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
    const allowed = 11;
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

  test("entering investigating writes trigger_at; leaving it does not", () => {
    const db = openDb(":memory:");
    const id = candidate(db, "pending", T0 - 1000);
    transition(db, id, "investigating", T0);
    transition(db, id, "pending_no_model", T0 + 5000);
    expect(db.query<{ trigger_at: number }, [number]>("SELECT trigger_at FROM candidates WHERE id = ?").get(id)?.trigger_at).toBe(T0);
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

describe("recovering cut-off investigations", () => {
  test("only cases investigating for longer than an investigation can take go back to the queue", () => {
    const db = openDb(":memory:");
    const stale = candidate(db, "investigating", T0 - STALE_MS - 1);
    const fresh = candidate(db, "investigating", T0 - 60_000);
    expect(recoverInterrupted(db, T0)).toBe(1);
    const st = (id: number) => db.query<{ state: string }, [number]>("SELECT state FROM candidates WHERE id = ?").get(id)?.state;
    expect([st(stale), st(fresh)]).toEqual(["pending_no_model", "investigating"]);
  });
});
