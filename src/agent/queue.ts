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
  // Straight to waiting for the model when it is known to be away: no attempt is made.
  pending: ["investigating", "pending_no_model"],
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

/**
 * Moves a candidate; entering `investigating` writes `started_at`. `trigger_at`, its place in the
 * queue, is left alone: a case that waited for the model keeps it (FR-028).
 */
export function transition(db: Database, id: number, to: CandidateState, now = Date.now()): void {
  const row = db.query<{ state: CandidateState }, [number]>("SELECT state FROM candidates WHERE id = ?").get(id);
  if (row === null) throw new TransitionError(`candidate ${id} does not exist`);
  if (!canTransition(row.state, to)) throw new TransitionError(`candidate ${id}: ${row.state} → ${to} is not allowed`);
  if (to === "investigating") db.query("UPDATE candidates SET state = ?, started_at = ? WHERE id = ?").run(to, now, id);
  else db.query("UPDATE candidates SET state = ? WHERE id = ?").run(to, id);
}

/** A new trigger for a case already past the queue: a reappearance, or a request from the panel. */
export function retrigger(db: Database, id: number, now = Date.now()): void {
  db.query("UPDATE candidates SET trigger_at = ? WHERE id = ?").run(now, id);
}

/**
 * What the live worker investigates, in order of arrival (FR-028): the cases waiting for the
 * agent or for the model, and the investigated ones triggered again since their last attempt
 * (they reappeared after the 6 h trigger). The ones waiting for budget were asked for with a paid
 * profile, so they wait for a new request.
 */
export function queued(db: Database): number[] {
  return db
    .query<{ id: number }, []>(
      `SELECT id FROM candidates
       WHERE state IN ('pending', 'pending_no_model') OR (state = 'investigated' AND trigger_at > started_at)
       ORDER BY trigger_at, id`,
    )
    .all()
    .map((r) => r.id);
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
    .query("UPDATE candidates SET state = 'pending_no_model' WHERE state = 'investigating' AND started_at < ?")
    .run(now - STALE_MS).changes;
}
