import type { Database } from "../db";
import type { LabelProgress, LabelValue } from "../shared/api";
import { stopping } from "./stopping";

// The sample (FR-018): every candidate the detector did not throw out, in the order the gaps
// started. Nobody picks which: the view only ever offers the next one.

/** Cases that can be labelled: triggered, whatever the agent did with them since. */
export const LABELABLE = "c.state NOT IN ('detected', 'discarded')";

export const LABEL_VALUES = ["coverage_gap", "likely_dark", "undeterminable"] as const satisfies readonly LabelValue[];

/** The oldest case without a label, or null. */
export function nextToLabel(db: Database): number | null {
  return (
    db
      .query<{ id: number }, []>(
        `SELECT c.id FROM candidates c LEFT JOIN labels l ON l.candidate_id = c.id
         WHERE ${LABELABLE} AND l.candidate_id IS NULL ORDER BY c.gap_start, c.id LIMIT 1`,
      )
      .get()?.id ?? null
  );
}

export function labelProgress(db: Database): LabelProgress {
  const n = db
    .query<{ labeled: number; positives: number; undeterminable: number; remaining: number }, []>(
      `SELECT count(l.candidate_id) AS labeled,
              count(*) FILTER (WHERE l.value = 'likely_dark') AS positives,
              count(*) FILTER (WHERE l.value = 'undeterminable') AS undeterminable,
              count(*) FILTER (WHERE l.candidate_id IS NULL) AS remaining
       FROM candidates c LEFT JOIN labels l ON l.candidate_id = c.id
       WHERE ${LABELABLE}`,
    )
    .get()!;
  return { ...n, stopping: stopping(n.labeled, n.positives) };
}
