import { afterEach, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { backoffDelay, connectStream, type Stream, type StreamEvent } from "../../src/ingest/digitraffic";
import { PacketReader } from "../../src/ingest/mqtt";
import { connackPacket, publishPacket, subackPacket } from "../fixtures/mqtt";

// A local stand-in for the Digitraffic broker: no network.
type Behaviour = "reply" | "silent" | "refuse";

let server: Server<{ reader: PacketReader }> | undefined;
let stream: Stream | undefined;

afterEach(() => {
  stream?.stop();
  server?.stop(true);
});

function fakeBroker(behaviour: Behaviour, subscribed: string[][]) {
  return Bun.serve<{ reader: PacketReader }>({
    port: 0,
    fetch(req, srv) {
      const ok = srv.upgrade(req, {
        data: { reader: new PacketReader() },
        headers: { "Sec-WebSocket-Protocol": "mqtt" },
      });
      return ok ? undefined : new Response("upgrade required", { status: 426 });
    },
    websocket: {
      message(ws, msg) {
        const bytes = typeof msg === "string" ? new TextEncoder().encode(msg) : new Uint8Array(msg);
        for (const p of ws.data.reader.push(bytes)) {
          if (p.type === 1) ws.send(connackPacket(behaviour === "refuse" ? 5 : 0));
          if (p.type === 8) {
            const topics: string[] = [];
            let i = 2;
            while (i < p.body.length) {
              const len = ((p.body[i] ?? 0) << 8) | (p.body[i + 1] ?? 0);
              topics.push(new TextDecoder().decode(p.body.subarray(i + 2, i + 2 + len)));
              i += 2 + len + 1;
            }
            subscribed.push(topics);
            ws.send(subackPacket(1, topics.map(() => 0)));
            if (behaviour === "reply") ws.send(publishPacket("vessels-v2/230713000/location", '{"lat":60.1,"lon":24.9}'));
          }
        }
      },
    },
  });
}

function collect(url: string, extra: { stallMs?: number } = {}) {
  const events: StreamEvent[] = [];
  stream = connectStream({ url, clientId: "test", minBackoffMs: 10, onEvent: (e) => events.push(e), ...extra });
  return events;
}

async function until(cond: () => boolean, ms = 3_000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out");
    await Bun.sleep(10);
  }
}

describe("Digitraffic stream", () => {
  test("subscribes after CONNACK and delivers parsed messages with their topic", async () => {
    const subscribed: string[][] = [];
    server = fakeBroker("reply", subscribed);
    const events = collect(`ws://localhost:${server.port}`);
    await until(() => events.some((e) => e.kind === "message"));

    expect(subscribed[0]).toEqual(["vessels-v2/+/location", "vessels-v2/+/metadata"]);
    const msg = events.find((e) => e.kind === "message");
    expect(msg?.kind === "message" && msg.topic).toBe("vessels-v2/230713000/location");
    expect(msg?.kind === "message" && msg.data).toEqual({ lat: 60.1, lon: 24.9 });
  });

  test("reports a refused connection and tries again", async () => {
    server = fakeBroker("refuse", []);
    const events = collect(`ws://localhost:${server.port}`);
    await until(() => events.filter((e) => e.kind === "close").length >= 2);

    expect(events).toContainEqual({ kind: "error", detail: "connection refused, code 5" });
    expect(events.some((e) => e.kind === "open")).toBe(false);
  });

  test("reconnects when the session goes silent", async () => {
    server = fakeBroker("silent", []);
    const events = collect(`ws://localhost:${server.port}`, { stallMs: 200 });
    await until(() => events.filter((e) => e.kind === "open").length >= 2);

    expect(events).toContainEqual({ kind: "error", detail: "no messages for 0.2 s" });
    // The close reason is not echoed back to the client that closed, only the code.
    expect(events.some((e) => e.kind === "close" && e.code === 4000)).toBe(true);
  });

  test("backoff doubles from 1 s and stops at 60 s", () => {
    expect([0, 1, 2, 5, 6, 20].map((a) => backoffDelay(a, 1_000, 60_000))).toEqual([
      1_000, 2_000, 4_000, 32_000, 60_000, 60_000,
    ]);
  });
});

