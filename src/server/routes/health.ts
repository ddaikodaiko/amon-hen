import { z } from "zod";
import { THRESHOLDS } from "../../config";
import { healthClosedUntil } from "../../ingest/health";
import type * as Api from "../../shared/api";
import { HttpError, type Route } from "../http";
import { instant, parse } from "./parse";

// The ingest's own health (FR-017): messages per minute, the connection, and our outages.

const DAY = 24 * 3_600_000;
export const HEALTH_SPAN = { defaultMs: DAY, maxMs: 7 * DAY } as const;

const Query = z.object({ from: instant.optional(), to: instant.optional() });

const health: Route = {
  method: "GET",
  path: "/api/health",
  handler: ({ url, app }) => {
    const q = parse(Query, Object.fromEntries(url.searchParams), "query");
    const closed = healthClosedUntil(app.db);
    // By default, the last day the ingest has closed.
    const to = q.to ?? (q.from !== undefined ? q.from + HEALTH_SPAN.defaultMs : (closed ?? Date.now()));
    const from = q.from ?? to - HEALTH_SPAN.defaultMs;
    if (to <= from) throw new HttpError(400, "invalid_request", "invalid query: `to` must come after `from`");
    if (to - from > HEALTH_SPAN.maxMs) throw new HttpError(400, "invalid_request", "invalid query: at most 7 days at a time");
    const minutes = app.db
      .query<{ m: number; n: number; c: number }, [number, number, number]>(
        "SELECT minute_ts AS m, msg_count AS n, connected AS c FROM ingest_minutes WHERE minute_ts >= ? AND minute_ts < ? AND minute_ts < ? ORDER BY minute_ts",
      )
      .all(from, to, closed ?? 0)
      .map((r): [number, number, number] => [r.m, r.n, r.c]);
    const outages = app.db
      .query<Api.OutageInfo, [number, number]>(
        "SELECT start_ts, end_ts, cause FROM outages WHERE start_ts < ? AND (end_ts IS NULL OR end_ts > ?) ORDER BY start_ts",
      )
      .all(to, from);
    const body: Api.HealthReport = {
      from,
      to,
      closed_until: closed,
      outage_after_min: THRESHOLDS.outageMinutes,
      minutes,
      outages,
      totals: {
        minutes: minutes.length,
        down: minutes.filter(([, n, c]) => n === 0 || c === 0).length,
        messages: minutes.reduce((s, [, n]) => s + n, 0),
      },
    };
    return Response.json(body);
  },
};

export const HEALTH_ROUTES: Route[] = [health];
