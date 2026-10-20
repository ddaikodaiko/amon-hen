import { monthOf, spentIn } from "../agent/budget";
import type { Config } from "../config";
import type { Database } from "../db";
import { flagOf } from "../geo/mid";
import type { Brief, BriefCase, BriefSections, DiscardReason, OutageInfo } from "../shared/api";

// The deterministic part of the daily brief (FR-023, R11): written at its hour even with the PC
// off. The model's paragraph comes later (narrative.ts).

export const BRIEF_TZ = "Europe/Madrid";
const HOUR = 3_600_000;
const TOP = 5;

/** The UTC offset of `tz` at instant `t`, in ms. */
function offsetAt(t: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(t);
  const n = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - Math.floor(t / 1000) * 1000;
}

/** The instant it is `hour`:00 on `date` (YYYY-MM-DD) in `tz`. */
export function zonedInstant(date: string, hour: number, tz = BRIEF_TZ): number {
  const naive = Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00Z`);
  // Twice, in case the first guess falls on the other side of a clock change.
  const first = naive - offsetAt(naive, tz);
  return naive - offsetAt(first, tz);
}

/** The date (YYYY-MM-DD) it is at `t` in `tz`. */
export const zonedDate = (t: number, tz = BRIEF_TZ) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(t);

/**
 * From the previous day's brief to this one's: 24 h, or 23 and 25 on the days the clocks change,
 * so that briefs neither overlap nor leave an hour out.
 */
export function briefWindow(date: string, hour: number): BriefSections["window"] {
  const end = zonedInstant(date, hour);
  const yesterday = new Date(Date.parse(`${date}T12:00:00Z`) - 24 * HOUR).toISOString().slice(0, 10);
  return { start: zonedInstant(yesterday, hour), end };
}

const VERDICT_RANK = { likely_dark: 0, inconclusive: 1, coverage_gap: 2 } as const;
const CONFIDENCE_RANK = { high: 0, medium: 1, low: 2 } as const;

/** Likely dark first, by confidence, then the longest gap (an open one is the longest); then the rest alike. */
export function rank(a: BriefCase, b: BriefCase): number {
  return (
    VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict] ||
    CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence] ||
    (b.duration_min ?? Infinity) - (a.duration_min ?? Infinity) ||
    a.gap_start - b.gap_start
  );
}

export function sections(db: Database, config: Config, date: string): BriefSections {
  const window = briefWindow(date, config.briefHour);
  const w = [window.start, window.end] as const;

  // Each case once, with its newest dossier, if that one was written in the window.
  const cases = db
    .query<Omit<BriefCase, "flag" | "duration_min"> & { gap_end: number | null }, [number, number]>(
      `SELECT c.id, c.mmsi, v.name, d.verdict, d.confidence, c.gap_start, c.gap_end
       FROM dossiers d
       JOIN candidates c ON c.id = d.candidate_id
       JOIN vessels v ON v.mmsi = c.mmsi
       WHERE d.created_at >= ? AND d.created_at < ?
         AND d.version = (SELECT max(version) FROM dossiers WHERE candidate_id = c.id)`,
    )
    .all(...w)
    .map(({ gap_end, ...c }): BriefCase => ({
      ...c,
      flag: flagOf(c.mmsi),
      duration_min: gap_end === null ? null : Math.round((gap_end - c.gap_start) / 60_000),
    }));
  const top = [...cases].sort(rank).slice(0, TOP);

  const waiting = { pending: 0, pending_no_model: 0, pending_budget: 0, error: 0 };
  for (const r of db.query<{ state: keyof typeof waiting; n: number }, []>(
    "SELECT state, count(*) AS n FROM candidates WHERE state IN ('pending', 'pending_no_model', 'pending_budget', 'error') GROUP BY state",
  ).all()) {
    waiting[r.state] = r.n;
  }
  const discarded: Record<DiscardReason, number> = { own_outage: 0, left_region: 0, berth: 0 };
  for (const r of db.query<{ reason: DiscardReason; n: number }, [number, number]>(
    "SELECT discard_reason AS reason, count(*) AS n FROM candidates WHERE state = 'discarded' AND created_at >= ? AND created_at < ? GROUP BY 1",
  ).all(...w)) {
    discarded[r.reason] = r.n;
  }

  const health = db
    .query<{ minutes: number; down: number; messages: number | null }, [number, number]>(
      `SELECT count(*) AS minutes, count(*) FILTER (WHERE msg_count = 0 OR connected = 0) AS down, sum(msg_count) AS messages
       FROM ingest_minutes WHERE minute_ts >= ? AND minute_ts < ?`,
    )
    .get(...w)!;
  const outages = db
    .query<OutageInfo, [number, number]>(
      "SELECT start_ts, end_ts, cause FROM outages WHERE start_ts < ? AND (end_ts IS NULL OR end_ts > ?) ORDER BY start_ts",
    )
    .all(window.end, window.start);
  const dayUsd = db
    .query<{ usd: number | null }, [number, number]>("SELECT sum(cost_usd) AS usd FROM dossiers WHERE created_at >= ? AND created_at < ?")
    .get(...w)!.usd;

  const count = (v: BriefCase["verdict"]) => cases.filter((c) => c.verdict === v).length;
  return {
    window,
    verdicts: { cases: cases.length, likely_dark: count("likely_dark"), coverage_gap: count("coverage_gap"), inconclusive: count("inconclusive") },
    waiting,
    discarded,
    top,
    health: { minutes: health.minutes, down: health.down, messages: health.messages ?? 0, outages },
    spend: { day_usd: dayUsd ?? 0, month_usd: spentIn(db, monthOf(window.end - 1)), cap_usd: config.budgetUsd },
  };
}

/**
 * Writes (or writes again) the brief of `date`. The paragraph waits for the model; with no case
 * in the window there is nothing for it to tell.
 */
export function generateBrief(db: Database, config: Config, date: string, now = Date.now()): Brief {
  const s = sections(db, config, date);
  const brief: Brief = { date, sections: s, narrative: null, narrative_state: s.verdicts.cases === 0 ? "skipped" : "pending", generated_at: now };
  db.query(
    `INSERT INTO briefs (date, sections_json, narrative, narrative_state, generated_at) VALUES (?, ?, NULL, ?, ?)
     ON CONFLICT (date) DO UPDATE SET sections_json = excluded.sections_json, narrative = NULL,
       narrative_state = excluded.narrative_state, generated_at = excluded.generated_at`,
  ).run(date, JSON.stringify(s), brief.narrative_state, now);
  return brief;
}

type BriefRow = { date: string; sections_json: string; narrative: string | null; narrative_state: Brief["narrative_state"]; generated_at: number };

export function readBrief(db: Database, date: string): Brief | null {
  const r = db.query<BriefRow, [string]>("SELECT * FROM briefs WHERE date = ?").get(date);
  return r === null ? null : { date: r.date, sections: JSON.parse(r.sections_json) as BriefSections, narrative: r.narrative, narrative_state: r.narrative_state, generated_at: r.generated_at };
}
