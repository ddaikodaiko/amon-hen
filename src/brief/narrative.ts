import type Anthropic from "@anthropic-ai/sdk";
import { canSpend, costUsd, estimateTokens, record, worstCaseUsd } from "../agent/budget";
import { unreachable } from "../agent/loop";
import type { ModelClient } from "../agent/model";
import type { Profile } from "../config";
import type { Database } from "../db";
import type { BriefSections } from "../shared/api";
import system from "./prompt.md" with { type: "text" };
import { readBrief } from "./sections";

// The brief's paragraph (R11): written by the model from the sections, without tools, whenever
// it is there after the brief's hour. Its cost goes to the month's budget like any other call.

export const MAX_TOKENS = 400;

export type NarrativeOutcome =
  | { state: "done"; text: string; cost_usd: number }
  /** Not there, or with nothing to tell. */
  | { state: "not_pending" }
  | { state: "no_model"; reason: string }
  | { state: "over_budget" }
  | { state: "error"; reason: string };

export interface NarrativeDeps {
  client: ModelClient;
  profile: Profile;
  capUsd: number;
  now?: () => number;
}

const iso = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ");

/** The sections as the model reads them: times in words, no ids it could quote as facts. */
export function briefForModel(s: BriefSections): string {
  return JSON.stringify(
    {
      from_utc: iso(s.window.start),
      to_utc: iso(s.window.end),
      verdicts: s.verdicts,
      still_waiting: s.waiting,
      top_cases: s.top.map((c) => ({
        vessel: c.name ?? `MMSI ${c.mmsi}`,
        flag: c.flag,
        verdict: c.verdict,
        confidence: c.confidence,
        silent_from_utc: iso(c.gap_start),
        silent_minutes: c.duration_min ?? "still silent after 6 h",
      })),
      gaps_discarded_by_the_detector: s.discarded,
      our_ingest: { minutes: s.health.minutes, minutes_down: s.health.down, outages: s.health.outages.length },
    },
    null,
    1,
  );
}

export async function writeNarrative(db: Database, date: string, deps: NarrativeDeps): Promise<NarrativeOutcome> {
  const now = deps.now ?? Date.now;
  const brief = readBrief(db, date);
  if (brief === null || brief.narrative_state !== "pending") return { state: "not_pending" };
  const down = await deps.client.unavailable();
  if (down !== null) return { state: "no_model", reason: down };

  const user = briefForModel(brief.sections);
  if (!canSpend(db, deps.profile, worstCaseUsd(deps.profile, estimateTokens(system + user), MAX_TOKENS), deps.capUsd, now())) {
    return { state: "over_budget" };
  }
  let msg: Anthropic.Message;
  try {
    msg = await deps.client.create({ system, messages: [{ role: "user", content: user }], max_tokens: MAX_TOKENS });
  } catch (err) {
    const reason = unreachable(err);
    if (reason !== null) return { state: "no_model", reason };
    return { state: "error", reason: err instanceof Error ? err.message : String(err) };
  }
  const cost = costUsd(msg.usage, deps.profile);
  record(db, cost, deps.capUsd, now());
  const text = msg.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("")
    .trim();
  if (text === "") return { state: "error", reason: "the model wrote nothing" };
  // Only if nobody wrote the brief again meanwhile.
  db.query("UPDATE briefs SET narrative = ?, narrative_state = 'done' WHERE date = ? AND narrative_state = 'pending' AND generated_at = ?").run(
    text,
    date,
    brief.generated_at,
  );
  return { state: "done", text, cost_usd: cost };
}
