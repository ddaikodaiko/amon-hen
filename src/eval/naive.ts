import { THRESHOLDS } from "../config";

// The rule the agent has to beat (FR-020): every gap longer than 60 minutes is likely_dark. It
// only looks at the gap, so it gives the same answer every time (SC-003).

export function naiveDark(gap: { gap_start: number; gap_end: number | null }): boolean {
  // An open gap reached the 6 h trigger: far longer than 60 minutes.
  return gap.gap_end === null || gap.gap_end - gap.gap_start > THRESHOLDS.naiveRuleMs;
}
