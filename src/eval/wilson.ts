// The Wilson score interval for a proportion (R12): it behaves with small samples and with
// proportions near 0 or 1, where the normal approximation does not.

import type { Interval } from "../shared/api";

export type { Interval };

/** 95 % by default. Null when there is nothing to divide by. */
export function wilson(successes: number, n: number, z = 1.96): Interval | null {
  if (n === 0) return null;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { p, low: Math.max(0, center - half), high: Math.min(1, center + half) };
}
