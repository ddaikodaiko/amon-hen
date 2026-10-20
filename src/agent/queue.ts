import type { Database } from "../db";

// A candidate's states (data-model.md, "Estados de un candidato"). Every change goes through
// transition(), which refuses the ones the diagram does not have.

export const STATES = [
  "detected",
  "discarded",
  "pending",
  "investigating",
  "investigated",
  "error",
  "pending_no_model",
  "pending_budget",
] as const;
export type CandidateState = (typeof STATES)[number];

const ALLOWED: Record<CandidateState, readonly CandidateState[]> = {
  detected: ["discarded", "pending"],
  discarded: [],
  pending: ["investigating"],
  investigating: ["investigated", "error", "pending_no_model", "pending_budget"],
  // A finished case is investigated again when the vessel reappears after 6 h, or by hand.
  investigated: ["investigating"],
  // Retried by hand.
  error: ["investigating"],
  pending_no_model: ["investigating"],
  pending_budget: ["investigating"],
};

/** States that wait for the agent, served first come, first served. */
export const WAITING: readonly CandidateState[] = ["pending", "pending_no_model", "pending_budget"];

export class TransitionError extends Error {}

export function canTransition(from: CandidateState, to: CandidateState): boolean {
  return ALLOWED[from].includes(to);
}

/** Moves a candidate; entering `investigating` writes `trigger_at`. */
export function transition(db: Database, id: number, to: CandidateState, now = Date.now()): void {
  const row = db.query<{ state: CandidateState }, [number]>("SELECT state FROM candidates WHERE id = ?").get(id);
  if (row === null) throw new TransitionError(`candidate ${id} does not exist`);
  if (!canTransition(row.state, to)) throw new TransitionError(`candidate ${id}: ${row.state} → ${to} is not allowed`);
  if (to === "investigating") db.query("UPDATE candidates SET state = ?, trigger_at = ? WHERE id = ?").run(to, now, id);
  else db.query("UPDATE candidates SET state = ? WHERE id = ?").run(to, id);
}

/** The waiting candidates, oldest trigger first. */
export function waiting(db: Database, states: readonly CandidateState[] = WAITING): number[] {
  const marks = states.map(() => "?").join(", ");
  return db
    .query<{ id: number }, string[]>(`SELECT id FROM candidates WHERE state IN (${marks}) ORDER BY trigger_at, id`)
    .all(...states)
    .map((r) => r.id);
}

/** An investigation takes 10 min at most (SC-005); one still going after this was cut off. */
export const STALE_MS = 15 * 60_000;

/**
 * Cases left in `investigating` by a process that died: the attempt is dropped (no dossier was
 * written) and they wait for the model again. Returns how many.
 */
export function recoverInterrupted(db: Database, now = Date.now()): number {
  return db
    .query("UPDATE candidates SET state = 'pending_no_model' WHERE state = 'investigating' AND trigger_at < ?")
    .run(now - STALE_MS).changes;
}
