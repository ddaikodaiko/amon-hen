import { z } from "zod";
import { defineTool, hhmm, instantInput, iso, ToolError } from "./tool";

const MAX_WINDOW_MS = 48 * 3_600_000;

export const getIngestHealth = defineTool({
  name: "get_ingest_health",
  description:
    "Health of our own AIS ingest between two times (48 h at most): its outages (2 min or more without " +
    "messages, or disconnected) and the fewest messages received in any minute. If our ingest was down, " +
    "every vessel looks silent.",
  input: z.object({ from: instantInput, to: instantInput }),
  run({ from, to }, { db }) {
    if (to <= from) throw new ToolError("`to` must be after `from`");
    if (to - from > MAX_WINDOW_MS) throw new ToolError("the window is 48 h at most");
    const outages = db
      .query<{ start_ts: number; end_ts: number | null; cause: string | null }, [number, number]>(
        "SELECT start_ts, end_ts, cause FROM outages WHERE start_ts < ? AND (end_ts IS NULL OR end_ts > ?) ORDER BY start_ts",
      )
      .all(to, from);
    const minutes = db
      .query<{ n: number; least: number | null }, [number, number]>(
        "SELECT count(*) AS n, min(msg_count) AS least FROM ingest_minutes WHERE minute_ts >= ? AND minute_ts < ?",
      )
      .get(Math.floor(from / 60_000) * 60_000, to);
    const known = minutes?.n ?? 0;
    const data = {
      outages: outages.map((o) => ({ start: iso(o.start_ts), end: o.end_ts === null ? null : iso(o.end_ts), cause: o.cause })),
      min_msg_per_min: known > 0 ? (minutes?.least ?? null) : null,
      minutes_known: known,
    };
    const span = `${hhmm(from)}-${hhmm(to)} UTC`;
    if (known === 0) return { summary: `Our ingest health for ${span} is not known.`, data };
    const summary =
      outages.length === 0
        ? `Our ingest had no outage ${span}; it received at least ${data.min_msg_per_min} messages every minute.`
        : `Our ingest had ${outages.length} outage${outages.length > 1 ? "s" : ""} ${span}: ` +
          `${outages.map((o) => `${hhmm(o.start_ts)}-${o.end_ts === null ? "ongoing" : hhmm(o.end_ts)}`).join(", ")}.`;
    return { summary, data };
  },
});
