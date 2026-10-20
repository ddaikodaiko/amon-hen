import { THRESHOLDS } from "../config";
import { type Database, getMeta, setMeta } from "../db";

// Health of our own ingest, per minute (FR-002). A minute is "down" if it had no messages or
// ended disconnected; a run of THRESHOLDS.outageMinutes down minutes or more is an outage.

const MIN = 60_000;
const floorMin = (ts: number) => Math.floor(ts / MIN) * MIN;

export const CLOSED_UNTIL = "health_closed_until";
const DOWN_SINCE = "health_down_since";

export interface ConnectionEvent {
  kind: "open" | "close";
  ts: number;
}

interface MinuteRow {
  minute_ts: number;
  connected: number;
  msg_count: number;
}

/** Every minute before this one is closed: its health is known. Null before the first close. */
export function healthClosedUntil(db: Database): number | null {
  const v = getMeta(db, CLOSED_UNTIL);
  return v === null ? null : Number(v);
}

export function countMessage(db: Database, ts: number): void {
  db.query(
    `INSERT INTO ingest_minutes (minute_ts, connected, msg_count) VALUES (?, 1, 1)
     ON CONFLICT (minute_ts) DO UPDATE SET msg_count = msg_count + 1, connected = 1`,
  ).run(floorMin(ts));
}

/** Records the connection state at the end of that minute. */
export function applyEvent(db: Database, ev: ConnectionEvent): void {
  db.query(
    `INSERT INTO ingest_minutes (minute_ts, connected, msg_count) VALUES (?, ?, 0)
     ON CONFLICT (minute_ts) DO UPDATE SET connected = excluded.connected`,
  ).run(floorMin(ev.ts), ev.kind === "open" ? 1 : 0);
}

/**
 * Closes every complete minute before `now`: fills the minutes nobody wrote (the process was
 * down, or nothing arrived) and opens or closes outages. Idempotent; the current minute stays open.
 */
export function closeMinutes(db: Database, now: number): void {
  const current = floorMin(now);
  const closedUntil = getMeta(db, CLOSED_UNTIL);
  const from =
    closedUntil !== null
      ? Number(closedUntil)
      : db.query<{ m: number | null }, []>("SELECT min(minute_ts) AS m FROM ingest_minutes").get()?.m;
  if (from === null || from === undefined || from >= current) return;

  const getMinute = db.query<MinuteRow, [number]>("SELECT * FROM ingest_minutes WHERE minute_ts = ?");
  const fill = db.query("INSERT INTO ingest_minutes (minute_ts, connected, msg_count) VALUES (?, ?, 0)");
  const openOutage = db.query("INSERT INTO outages (start_ts, cause) VALUES (?, ?)");
  const endOutage = db.query("UPDATE outages SET end_ts = ? WHERE end_ts IS NULL");
  const markDisconnected = db.query("UPDATE outages SET cause = 'disconnected' WHERE end_ts IS NULL");
  const disconnectedIn = db.query<{ n: number }, [number, number]>(
    "SELECT count(*) AS n FROM ingest_minutes WHERE minute_ts BETWEEN ? AND ? AND connected = 0",
  );

  db.transaction(() => {
    let connected = getMinute.get(from - MIN)?.connected ?? 1;
    const since = getMeta(db, DOWN_SINCE);
    let downSince = since === null ? null : Number(since);
    let open = db.query("SELECT 1 FROM outages WHERE end_ts IS NULL").get() !== null;

    for (let m = from; m < current; m += MIN) {
      let row = getMinute.get(m);
      if (row === null) {
        fill.run(m, connected);
        row = { minute_ts: m, connected, msg_count: 0 };
      }
      connected = row.connected;
      const down = row.msg_count === 0 || row.connected === 0;

      if (!down) {
        downSince = null;
        if (open) endOutage.run(m);
        open = false;
        continue;
      }
      downSince ??= m;
      if (open) {
        if (row.connected === 0) markDisconnected.run();
      } else if ((m - downSince) / MIN + 1 >= THRESHOLDS.outageMinutes) {
        const cause = (disconnectedIn.get(downSince, m)?.n ?? 0) > 0 ? "disconnected" : "no_messages";
        openOutage.run(downSince, cause);
        open = true;
      }
    }

    setMeta(db, CLOSED_UNTIL, String(current));
    if (downSince === null) db.query("DELETE FROM meta WHERE key = ?").run(DOWN_SINCE);
    else setMeta(db, DOWN_SINCE, String(downSince));
  }).immediate();
}
