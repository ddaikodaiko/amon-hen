import { parseArgs } from "node:util";
import { loadConfig } from "../config";
import { openDb } from "../db";
import { connectStream, fetchMetadata } from "../ingest/digitraffic";
import { closeMinutes } from "../ingest/health";
import { importArchive } from "../ingest/import";
import { parseMessage } from "../ingest/parse";
import { applyEvent, applyMessage, ingestRaw } from "../ingest/pipeline";
import { RawArchive } from "../ingest/raw-archive";
import { prune } from "../ingest/retention";

function log(msg: string): void {
  console.log(`${new Date().toISOString()} ${msg}`);
}

function isoArg(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const t = Date.parse(value);
  if (Number.isNaN(t)) throw new Error(`--${name}: not an ISO date: ${value}`);
  return t;
}

/** vessels-v2/<mmsi>/location → mmsi */
function mmsiOf(topic: string): number | null {
  const mmsi = Number(topic.split("/")[1]);
  return Number.isInteger(mmsi) ? mmsi : null;
}

const { values: args } = parseArgs({
  options: { "from-archive": { type: "string" }, from: { type: "string" }, to: { type: "string" } },
});
const config = loadConfig();
const db = openDb(config.dbPath);

if (args["from-archive"] !== undefined) {
  const dir = args["from-archive"];
  const range = { from: isoArg("from", args.from), to: isoArg("to", args.to) };
  const existing = db.query<{ n: number }, []>("SELECT count(*) AS n FROM ingest_minutes").get()?.n ?? 0;
  if (existing > 0) log(`warning: ${config.dbPath} already has ${existing} health minutes; counts may add up twice`);
  const t0 = performance.now();
  const stats = importArchive(db, dir, range, (path, s) =>
    log(`${path}: ${s.messages} messages so far, ${s.stored} stored`),
  );
  const span =
    stats.first === null ? "nothing in range" : `${new Date(stats.first).toISOString()} → ${new Date(stats.last ?? stats.first).toISOString()}`;
  log(`imported ${stats.files} files, ${stats.messages} messages, ${stats.stored} stored (${span}) in ${Math.round(performance.now() - t0)} ms`);
  db.close();
  process.exit(0);
}

const RAW_ROOT = "data/raw";
const archive = new RawArchive(RAW_ROOT);
await archive.init();

try {
  const metadata = await fetchMetadata();
  const t = Date.now();
  db.transaction(() => {
    for (const m of metadata) {
      archive.write({ t, m, src: "rest" });
      const msg = parseMessage(m.topic, m.data, t);
      if (msg !== null) applyMessage(db, msg);
    }
  })();
  log(`static data for ${metadata.length} vessels`);
} catch (err) {
  log(`could not fetch static data, continuing with the stream only: ${String(err)}`);
}

/**
 * Without a connection for this long, the process exits with an error so that systemd starts a
 * fresh one. After a network change (the laptop moved on 2026-10-20) Bun's WebSocket kept failing
 * to connect for hours while a new process connected at once.
 */
const RESTART_AFTER_MS = 10 * 60_000;

let stopping = false;
let connected = false;
let disconnectedSince: number | null = Date.now();
let minutePositions = 0;
let minuteMetadata = 0;
let minuteVessels = new Set<number>();
const allVessels = new Set<number>();

const stream = connectStream({
  onEvent(ev) {
    if (stopping) return;
    switch (ev.kind) {
      case "message": {
        archive.write({ t: ev.receivedAt, m: { topic: ev.topic, data: ev.data } });
        ingestRaw(db, ev.topic, ev.data, ev.receivedAt);
        if (!ev.topic.endsWith("/location")) {
          minuteMetadata++;
          break;
        }
        minutePositions++;
        const mmsi = mmsiOf(ev.topic);
        if (mmsi !== null) {
          minuteVessels.add(mmsi);
          allVessels.add(mmsi);
        }
        break;
      }
      case "open":
        connected = true;
        disconnectedSince = null;
        archive.write({ t: Date.now(), ev: "open", detail: ev.extensions || undefined });
        applyEvent(db, { kind: "open", ts: Date.now() });
        log(`connected, extensions: ${ev.extensions || "none"}`);
        break;
      case "close":
        connected = false;
        disconnectedSince ??= Date.now();
        archive.write({ t: Date.now(), ev: "close", detail: `${ev.code} ${ev.reason}`.trim() });
        applyEvent(db, { kind: "close", ts: Date.now() });
        log(`closed: ${ev.code} ${ev.reason}`);
        break;
      case "error":
        archive.write({ t: Date.now(), ev: "error", detail: ev.detail });
        log(`error: ${ev.detail}`);
        break;
    }
  },
});

const flushTimer = setInterval(() => archive.flush(), 1_000);

// 30 days of positions and raw archive, except the recorded windows: a minute after starting, then daily.
async function retention(): Promise<void> {
  try {
    const p = await prune(db, RAW_ROOT, Date.now());
    if (p.positions + p.files > 0) log(`retention: ${p.positions} positions and ${p.files} raw hour files older than 30 days removed`);
  } catch (err) {
    if (!stopping) log(`retention failed: ${String(err)}`);
  }
}
const firstRetention = setTimeout(() => void retention(), 60_000);
const retentionTimer = setInterval(() => void retention(), 24 * 3_600_000);

const reportTimer = setInterval(() => {
  closeMinutes(db, Date.now());
  const mb = (archive.bytesWritten / 1e6).toFixed(1);
  log(
    `positions/min=${minutePositions} metadata/min=${minuteMetadata} vessels/min=${minuteVessels.size} ` +
      `vessels_total=${allVessels.size} connected=${connected ? "yes" : "no"} archived_mb=${mb}`,
  );
  minutePositions = 0;
  minuteMetadata = 0;
  minuteVessels = new Set();
  if (disconnectedSince !== null && Date.now() - disconnectedSince >= RESTART_AFTER_MS) {
    void shutdown(`no connection for ${RESTART_AFTER_MS / 60_000} min, exiting for a fresh start`, 1);
  }
}, 60_000);

async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (stopping) return;
  stopping = true;
  clearInterval(flushTimer);
  clearInterval(reportTimer);
  clearTimeout(firstRetention);
  clearInterval(retentionTimer);
  stream.stop();
  archive.write({ t: Date.now(), ev: "close", detail: `shutdown (${signal})` });
  applyEvent(db, { kind: "close", ts: Date.now() });
  await archive.close();
  db.close();
  log(`stopped (${signal})`);
  process.exit(exitCode);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
