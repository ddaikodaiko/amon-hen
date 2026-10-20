import { THRESHOLDS } from "../config";
import type { Database } from "../db";
import { positionsAt, type Range, ReplayClock, recordedRange, SPEEDS, type Speed } from "../replay/clock";
import type { StreamEvents } from "../shared/api";
import { HttpError, type Route } from "./http";

// GET /api/stream (SSE). A session per connection gives the events of each tick; the route only
// sends them. In live and public the time is the clock's; in replay, the viewer's replay clock.

export type StreamEvent = { [K in keyof StreamEvents]: { event: K; data: StreamEvents[K] } }[keyof StreamEvents];

const MIN = 60_000;
/** Gap marks stay on the map this long. */
export const MARKS_MS = 24 * 60 * MIN;
/** Ticks look back this much too, for rows committed a moment after their timestamp. */
const OVERLAP_MS = 5_000;

/**
 * When things become visible. Live: when they were written. Replay: when they would have been,
 * from the data: the detector flags a gap at its threshold, and the agent investigates when the
 * vessel reappears or at 6 h.
 */
interface Timing {
  seen: string;
  ready: string;
}
const LIVE: Timing = { seen: "c.created_at", ready: "d.created_at" };
const REPLAY: Timing = {
  seen: `c.gap_start + CASE c.ais_class WHEN 'A' THEN ${THRESHOLDS.gapClassAMs} ELSE ${THRESHOLDS.gapClassBMs} END`,
  ready: `coalesce(c.gap_end, c.gap_start + ${THRESHOLDS.triggerMs})`,
};

export class StreamSession {
  private prev: number | null = null;
  private minute: number | null = null;
  private readonly sentMarks = new Set<number>();
  private readonly sentVerdicts = new Set<string>();

  constructor(
    private readonly db: Database,
    private readonly mode: StreamEvents["hello"]["mode"],
    private readonly time: () => number,
    private readonly replay: ReplayClock | null = null,
  ) {}

  private get timing(): Timing {
    return this.replay === null ? LIVE : REPLAY;
  }

  open(): StreamEvent[] {
    const t = this.time();
    const hello: StreamEvent = {
      event: "hello",
      data: { mode: this.mode, t, range: this.replay?.range ?? null, speed: this.replay?.speed ?? null },
    };
    return [hello, ...this.snapshot(t)];
  }

  tick(): StreamEvent[] {
    const t = this.time();
    const out: StreamEvent[] = [];
    if (this.prev !== null && t < this.prev) {
      // The replay started over.
      this.sentMarks.clear();
      this.sentVerdicts.clear();
      this.minute = null;
      out.push({ event: "reset", data: { t } }, ...this.snapshot(t));
    } else {
      const from = (this.prev ?? t) - OVERLAP_MS;
      out.push(...this.marks(from, t), ...this.verdicts(from, t));
      this.prev = t;
    }
    out.push({ event: "positions", data: { t, vessels: positionsAt(this.db, t) } });
    out.push(...this.health(t));
    return out;
  }

  private snapshot(t: number): StreamEvent[] {
    this.prev = t;
    return [...this.marks(t - MARKS_MS, t), ...this.verdicts(t - MARKS_MS - THRESHOLDS.triggerMs, t)];
  }

  private marks(from: number, to: number): StreamEvent[] {
    const rows = this.db
      .query<StreamEvents["candidate"], [number, number]>(
        `SELECT c.id, c.mmsi, c.start_lat AS lat, c.start_lon AS lon, c.gap_start FROM candidates c
         WHERE c.state NOT IN ('detected', 'discarded') AND ${this.timing.seen} > ? AND ${this.timing.seen} <= ?
         ORDER BY c.gap_start`,
      )
      .all(from, to)
      .filter((r) => !this.sentMarks.has(r.id));
    for (const r of rows) this.sentMarks.add(r.id);
    return rows.map((data) => ({ event: "candidate", data }));
  }

  private verdicts(from: number, to: number): StreamEvent[] {
    // Replay shows the newest dossier; live, each new one as it is written.
    const newest = this.replay === null ? "" : "AND d.version = (SELECT max(version) FROM dossiers WHERE candidate_id = c.id)";
    const rows = this.db
      .query<StreamEvents["dossier"], [number, number]>(
        `SELECT d.candidate_id, d.version, d.verdict, d.confidence FROM dossiers d JOIN candidates c ON c.id = d.candidate_id
         WHERE ${this.timing.ready} > ? AND ${this.timing.ready} <= ? ${newest}
         ORDER BY ${this.timing.ready}`,
      )
      .all(from, to)
      .filter((r) => !this.sentVerdicts.has(`${r.candidate_id}:${r.version}`));
    for (const r of rows) this.sentVerdicts.add(`${r.candidate_id}:${r.version}`);
    return rows.map((data) => ({ event: "dossier", data }));
  }

  private health(t: number): StreamEvent[] {
    const minute = Math.floor(t / MIN) * MIN - MIN;
    if (minute === this.minute) return [];
    this.minute = minute;
    const row = this.db
      .query<{ connected: number; msg_count: number }, [number]>("SELECT connected, msg_count FROM ingest_minutes WHERE minute_ts = ?")
      .get(minute);
    if (row === null) return [];
    return [{ event: "health", data: { minute, connected: row.connected === 1, msg_count: row.msg_count } }];
  }
}

export function encode(e: StreamEvent): string {
  return `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`;
}

function replayClock(db: Database, url: URL): ReplayClock {
  const range: Range | null = recordedRange(db);
  if (range === null) throw new HttpError(404, "no_recording", "this database has no positions to replay");
  const speed = Number(url.searchParams.get("speed") ?? "60");
  if (!SPEEDS.includes(speed as Speed)) throw new HttpError(400, "invalid_request", `speed must be one of ${SPEEDS.join(", ")}`);
  const at = url.searchParams.get("at");
  if (at !== null && !/^\d+$/.test(at)) throw new HttpError(400, "invalid_request", "at must be a time in UTC milliseconds");
  return new ReplayClock(range, speed as Speed, at === null ? range.start : Number(at));
}

export const TICK_MS = 1_000;

export const streamRoute: Route = {
  method: "GET",
  path: "/api/stream",
  handler: ({ req, url, app }) => {
    const clock = app.mode === "replay" ? replayClock(app.db, url) : null;
    const session = new StreamSession(app.db, app.mode, clock === null ? Date.now : () => clock.now(), clock);
    const bytes = new TextEncoder();
    let timer: ReturnType<typeof setInterval> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (events: StreamEvent[]) => {
          for (const e of events) controller.enqueue(bytes.encode(encode(e)));
        };
        send(session.open());
        timer = setInterval(() => {
          try {
            send(session.tick());
          } catch (err) {
            clearInterval(timer);
            controller.error(err);
          }
        }, TICK_MS);
        req.signal.addEventListener("abort", () => clearInterval(timer));
      },
      cancel() {
        clearInterval(timer);
      },
    });
    return new Response(body, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
    });
  },
};
