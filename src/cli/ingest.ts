import { connectStream } from "../ingest/aisstream";
import { RawArchive } from "../ingest/raw-archive";

const apiKey = process.env.AISSTREAM_KEY;
if (!apiKey) {
  console.error("AISSTREAM_KEY is missing: put it in .env");
  process.exit(1);
}

function log(msg: string): void {
  console.log(`${new Date().toISOString()} ${msg}`);
}

function mmsiOf(data: unknown): number | null {
  if (typeof data !== "object" || data === null || !("MetaData" in data)) return null;
  const meta = data.MetaData;
  if (typeof meta !== "object" || meta === null || !("MMSI" in meta)) return null;
  return typeof meta.MMSI === "number" ? meta.MMSI : null;
}

const archive = new RawArchive("data/raw");
await archive.init();

let stopping = false;
let connected = false;
let deflate = false;
let minuteMessages = 0;
let minuteVessels = new Set<number>();
const allVessels = new Set<number>();

const stream = connectStream({
  apiKey,
  onEvent(ev) {
    if (stopping) return;
    switch (ev.kind) {
      case "message": {
        archive.write({ t: ev.receivedAt, m: ev.data });
        minuteMessages++;
        const mmsi = mmsiOf(ev.data);
        if (mmsi !== null) {
          minuteVessels.add(mmsi);
          allVessels.add(mmsi);
        }
        break;
      }
      case "open":
        connected = true;
        deflate = ev.extensions.includes("permessage-deflate");
        archive.write({ t: Date.now(), ev: "open", detail: ev.extensions || undefined });
        log(`connected, extensions: ${ev.extensions || "none"}`);
        break;
      case "close":
        connected = false;
        archive.write({ t: Date.now(), ev: "close", detail: `${ev.code} ${ev.reason}`.trim() });
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

const reportTimer = setInterval(() => {
  const mb = (archive.bytesWritten / 1e6).toFixed(1);
  log(
    `msgs/min=${minuteMessages} vessels/min=${minuteVessels.size} vessels_total=${allVessels.size} ` +
      `connected=${connected ? "yes" : "no"} deflate=${deflate ? "yes" : "no"} archived_mb=${mb}`,
  );
  minuteMessages = 0;
  minuteVessels = new Set();
}, 60_000);

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  clearInterval(flushTimer);
  clearInterval(reportTimer);
  stream.stop();
  archive.write({ t: Date.now(), ev: "close", detail: `shutdown (${signal})` });
  await archive.close();
  log(`stopped (${signal})`);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
