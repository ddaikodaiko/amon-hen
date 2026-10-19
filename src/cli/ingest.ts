import { connectStream } from "../ingest/digitraffic";
import { RawArchive } from "../ingest/raw-archive";

function log(msg: string): void {
  console.log(`${new Date().toISOString()} ${msg}`);
}

/** vessels-v2/<mmsi>/location → mmsi */
function mmsiOf(topic: string): number | null {
  const mmsi = Number(topic.split("/")[1]);
  return Number.isInteger(mmsi) ? mmsi : null;
}

const archive = new RawArchive("data/raw");
await archive.init();

let stopping = false;
let connected = false;
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
    `positions/min=${minutePositions} metadata/min=${minuteMetadata} vessels/min=${minuteVessels.size} ` +
      `vessels_total=${allVessels.size} connected=${connected ? "yes" : "no"} archived_mb=${mb}`,
  );
  minutePositions = 0;
  minuteMetadata = 0;
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
