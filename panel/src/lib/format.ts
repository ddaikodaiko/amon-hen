import type { CandidateState, Confidence, DiscardReason, Interval, LabelValue, VerdictValue } from "./api";

// How the panel words and formats things. Times are shown in UTC, as the data is.

export const VERDICT_LABEL: Record<VerdictValue, string> = {
  likely_dark: "Likely dark",
  coverage_gap: "Coverage gap",
  inconclusive: "Inconclusive",
};

export const LABEL_LABEL: Record<LabelValue, string> = {
  coverage_gap: "Coverage gap",
  likely_dark: "Likely dark",
  undeterminable: "Undeterminable",
};

/** ITU navigation status, as the vessel set it. */
export const NAV_STATUS: Record<number, string> = {
  0: "under way using engine",
  1: "at anchor",
  2: "not under command",
  3: "restricted manoeuvrability",
  4: "constrained by draught",
  5: "moored",
  6: "aground",
  7: "engaged in fishing",
  8: "under way sailing",
};

export const CONFIDENCE_LABEL: Record<Confidence, string> = { high: "high", medium: "medium", low: "low" };

export const STATE_LABEL: Record<CandidateState, string> = {
  detected: "Detected",
  discarded: "Discarded",
  pending: "Waiting",
  investigating: "Investigating",
  investigated: "Investigated",
  error: "Error",
  pending_no_model: "Waiting for the model",
  pending_budget: "Waiting for budget",
};

/** Why a case is in a state that needs explaining (FR-015). */
export const STATE_HELP: Partial<Record<CandidateState, string>> = {
  pending: "Ready; the agent takes the cases in order of arrival.",
  investigating: "The agent is working on it now.",
  error: "The agent did not reach a valid verdict within its limits. It can be investigated again.",
  pending_no_model: "The model did not answer. The case is investigated when it comes back, in order of arrival.",
  pending_budget: "Investigating it could go over this month's spending cap. It waits for a new month or a higher cap.",
};

export const DISCARD_LABEL: Record<DiscardReason, string> = {
  own_outage: "our own outage",
  left_region: "left the region",
  berth: "at a berth",
};

const pad = (n: number) => String(n).padStart(2, "0");

/** 2026-10-19 07:39 UTC */
export function utc(ts: number, seconds = false): string {
  const d = new Date(ts);
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${seconds ? `:${pad(d.getUTCSeconds())}` : ""}`;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${time}`;
}

export function minutes(min: number | null): string {
  if (min === null) return "open";
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${pad(min % 60)} min`;
}

export function ms(n: number): string {
  return n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`;
}

/** Costs are tiny: $0 for the local model, fractions of a cent for the paid ones. */
export function usd(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

/** 0.72 [0.55, 0.85] */
export function interval(i: Interval | null): string {
  return i === null ? "—" : `${i.p.toFixed(2)} [${i.low.toFixed(2)}, ${i.high.toFixed(2)}]`;
}

export function tokens(n: number): string {
  return n < 10_000 ? String(n) : `${(n / 1000).toFixed(1)}k`;
}

/** Pretty JSON, or the text as it is when it is not JSON (an output cut at 32 KB). */
export function prettyJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}
