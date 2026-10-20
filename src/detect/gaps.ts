import { THRESHOLDS } from "../config";
import type { AisClass } from "../ingest/parse";

// Silences in one vessel's stored positions (FR-005, R8). Pure: no database, no clock.

export interface Fix {
  ts: number;
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
  nav_status: number | null;
}

export interface Gap {
  /** Last fix before the silence. */
  start: Fix;
  /** First fix after it; null while the vessel is still silent at the horizon. */
  end: Fix | null;
}

export function thresholdFor(cls: AisClass): number {
  return cls === "A" ? THRESHOLDS.gapClassAMs : THRESHOLDS.gapClassBMs;
}

/**
 * Silences of `thresholdMs` or more between consecutive fixes (sorted by time), plus the open
 * one after the last fix if it already lasts that long at `horizon`. The navigation status the
 * vessel declares does not matter: under way or at anchor, a silence is a silence.
 */
export function findGaps(fixes: readonly Fix[], thresholdMs: number, horizon: number): Gap[] {
  const gaps: Gap[] = [];
  for (let i = 1; i < fixes.length; i++) {
    const a = fixes[i - 1]!;
    const b = fixes[i]!;
    if (b.ts - a.ts >= thresholdMs) gaps.push({ start: a, end: b });
  }
  const last = fixes.at(-1);
  if (last !== undefined && horizon - last.ts >= thresholdMs) gaps.push({ start: last, end: null });
  return gaps;
}
