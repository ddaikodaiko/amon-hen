import type { CandidateState, CandidateSummary, Confidence, DiscardReason, Interval, LabelValue, Near, ProfileName, VerdictValue } from "./api";

// How the panel words and formats things, for someone who knows nothing about ships or AIS.
// Times are shown in UTC, as the data is.

/** The AI's verdict, in words. */
export const VERDICT_LABEL: Record<VerdictValue, string> = {
  likely_dark: "Transponder likely switched off",
  coverage_gap: "Out of receiver range",
  inconclusive: "Unclear",
};

/** The same, in one or two words for a pill. */
export const VERDICT_SHORT: Record<VerdictValue, string> = {
  likely_dark: "Suspicious",
  coverage_gap: "Out of range",
  inconclusive: "Unclear",
};

/** What each verdict means, for the legend and the report. */
export const VERDICT_HELP: Record<VerdictValue, string> = {
  likely_dark: "Receivers work well there and the ships around kept transmitting, so the ship itself probably went quiet.",
  coverage_gap: "The shore receivers could not hear it there: the ship was most likely transmitting all along.",
  inconclusive: "The evidence points both ways.",
};

export const LABEL_LABEL: Record<LabelValue, string> = {
  coverage_gap: "Out of receiver range",
  likely_dark: "Transponder switched off",
  undeterminable: "Can't tell",
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

export const PROFILE_LABEL: Record<ProfileName, string> = { local: "Local model (free)", haiku: "Claude Haiku", sonnet: "Claude Sonnet" };

export const CONFIDENCE_LABEL: Record<Confidence, string> = { high: "high", medium: "medium", low: "low" };

export const STATE_LABEL: Record<CandidateState, string> = {
  detected: "Still silent",
  discarded: "Ignored",
  pending: "Waiting for the AI",
  investigating: "AI analysing",
  investigated: "Analysed",
  error: "AI failed",
  pending_no_model: "Waiting for the AI",
  pending_budget: "Waiting for budget",
};

/** Why an alert is in a state that needs explaining (FR-015). */
export const STATE_HELP: Partial<Record<CandidateState, string>> = {
  pending: "In the queue: the AI analyst takes alerts in the order they came in.",
  investigating: "The AI analyst is looking at it right now.",
  error: "The AI analyst could not reach a sound verdict within its limits. It can be asked again.",
  pending_no_model: "The AI analyst is offline (the model does not answer). It will look at this alert as soon as it is back, in order of arrival.",
  pending_budget: "Analysing it could go over this month's spending cap. Ask again with the free local model, or with a paid one once there is budget (a new month or a higher cap).",
};

export const DISCARD_LABEL: Record<DiscardReason, string> = {
  own_outage: "our own feed was down",
  left_region: "it was leaving the area",
  berth: "it was in port",
};

/** The same, after a count: "3 in port". */
export const DISCARD_SHORT: Record<DiscardReason, string> = {
  own_outage: "while our feed was down",
  left_region: "leaving the area",
  berth: "in port",
};

export const COUNTRY: Record<Near["country"], string> = { FI: "Finland", EE: "Estonia", RU: "Russia" };

/** "4 km SW of Kronstadt, Russia", or "at Kronstadt, Russia". */
export function placeText(n: Near): string {
  const where = n.dir === null ? `at ${n.name}` : `${n.km} km ${n.dir} of ${n.name}`;
  return `${where}, ${COUNTRY[n.country]}`;
}

/** "Tug · Russia flag" */
export function vesselLine(v: { type_label: string | null; flag: string | null }): string {
  const type = v.type_label === null ? "Ship" : v.type_label.charAt(0).toUpperCase() + v.type_label.slice(1);
  return v.flag === null ? type : `${type} · ${v.flag} flag`;
}

export type Tone = "dark" | "unclear" | "range" | "working" | "waiting" | "failed" | "ignored";

export const VERDICT_TONE: Record<VerdictValue, Tone> = { likely_dark: "dark", inconclusive: "unclear", coverage_gap: "range" };

/** An alert in one word or two, and its colour: the AI's verdict if there is one, else where it is. */
export function alertStatus(c: Pick<CandidateSummary, "state" | "dossier">): { text: string; tone: Tone } {
  if (c.state === "investigating") return { text: "AI analysing", tone: "working" };
  if (c.dossier !== null) return { text: VERDICT_SHORT[c.dossier.verdict], tone: VERDICT_TONE[c.dossier.verdict] };
  if (c.state === "error") return { text: "AI failed", tone: "failed" };
  if (c.state === "discarded") return { text: "Ignored", tone: "ignored" };
  if (c.state === "detected") return { text: "Still silent", tone: "ignored" };
  return { text: "Awaiting AI", tone: "waiting" };
}

/** "20 Oct 10:35" */
export function when(ts: number): string {
  const d = new Date(ts);
  const month = d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  return `${d.getUTCDate()} ${month} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** "5 min ago", "3 h ago", "2 days ago" */
export function ago(ts: number, now: number = Date.now()): string {
  const min = Math.max(0, Math.round((now - ts) / 60_000));
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 2026-10-19 07:39 UTC */
export function utc(ts: number, seconds = false): string {
  const d = new Date(ts);
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${seconds ? `:${pad(d.getUTCSeconds())}` : ""}`;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${time}`;
}

export function minutes(min: number | null): string {
  if (min === null) return "still silent";
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
