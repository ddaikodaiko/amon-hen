import type { StoppingState } from "../shared/api";

// When the labelled sample is enough to publish (FR-021): 100 cases or more with at least 15
// likely_dark, or 300 cases whatever the positives (then they are reported as rare).

export const STOPPING = { minCases: 100, minPositives: 15, maxCases: 300 } as const;

export function stopping(cases: number, positives: number): StoppingState {
  const missing_cases = Math.max(0, STOPPING.minCases - cases);
  const missing_positives = Math.max(0, STOPPING.minPositives - positives);
  if (missing_cases === 0 && missing_positives === 0) return { met: true, status: "enough", missing_cases, missing_positives };
  if (cases >= STOPPING.maxCases) return { met: true, status: "rare_positives", missing_cases: 0, missing_positives };
  return { met: false, status: "insufficient", missing_cases, missing_positives };
}
