import type { Profile } from "../config";
import type { Database } from "../db";

// Monthly spending cap (FR-011, principle V). The cost always comes from `usage` and the
// profile's prices; the local profile costs 0 and is never blocked. Months are UTC.

export interface Tokens {
  input_tokens: number;
  output_tokens: number;
}

export function costUsd(usage: Tokens, profile: Profile): number {
  return (usage.input_tokens * profile.usdPerMTokIn + usage.output_tokens * profile.usdPerMTokOut) / 1_000_000;
}

/** What a call could cost at most: the estimated input plus all of max_tokens as output. */
export function worstCaseUsd(profile: Profile, inputTokens: number, maxTokens: number): number {
  return costUsd({ input_tokens: inputTokens, output_tokens: maxTokens }, profile);
}

/** A generous token estimate for the worst case: ~3 characters per token. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 3);

export const monthOf = (ts: number) => new Date(ts).toISOString().slice(0, 7);

export function spentIn(db: Database, month: string): number {
  return db.query<{ spent_usd: number }, [string]>("SELECT spent_usd FROM budget WHERE month = ?").get(month)?.spent_usd ?? 0;
}

/** Checked before every model call, with the call's worst case. */
export function canSpend(db: Database, profile: Profile, worstUsd: number, capUsd: number, now = Date.now()): boolean {
  if (!profile.paid) return true;
  return spentIn(db, monthOf(now)) + worstUsd <= capUsd;
}

export function record(db: Database, cost: number, capUsd: number, now = Date.now()): void {
  if (cost <= 0) return;
  db.query(
    `INSERT INTO budget (month, spent_usd, cap_usd) VALUES (?, ?, ?)
     ON CONFLICT (month) DO UPDATE SET spent_usd = spent_usd + excluded.spent_usd, cap_usd = excluded.cap_usd`,
  ).run(monthOf(now), cost, capUsd);
}
