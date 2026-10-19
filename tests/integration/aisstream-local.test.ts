import { afterEach, expect, test } from "bun:test";
import type { Server } from "bun";
import { connectStream, type Stream, type StreamEvent } from "../../src/ingest/aisstream";

// A local stand-in for aisstream: no network, no key.
type Behaviour = "reply" | "silent" | "reject";

let server: Server<undefined> | undefined;
let stream: Stream | undefined;

afterEach(() => {
  stream?.stop();
  server?.stop(true);
});

function fakeAisstream(behaviour: Behaviour, subscriptions: unknown[]) {
  return Bun.serve({
    port: 0,
    fetch(req, srv) {
      return srv.upgrade(req) ? undefined : new Response("upgrade required", { status: 426 });
    },
    websocket: {
      perMessageDeflate: true,
      message(ws, msg) {
        subscriptions.push(JSON.parse(String(msg)));
        if (behaviour === "reply") {
          ws.send(JSON.stringify({ MessageType: "PositionReport", MetaData: { MMSI: 224000001 } }));
        } else if (behaviour === "reject") {
          ws.send(JSON.stringify({ error: "Api Key Is Not Valid" }));
          ws.close();
        }
      },
    },
  });
}

function collect(url: string, extra: { stallMs?: number } = {}) {
  const events: StreamEvent[] = [];
  stream = connectStream({ apiKey: "test-key", url, minBackoffMs: 10, onEvent: (e) => events.push(e), ...extra });
  return events;
}

async function until(cond: () => boolean, ms = 3_000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out");
    await Bun.sleep(10);
  }
}

test("subscribes on open, negotiates permessage-deflate and delivers messages", async () => {
  const subs: unknown[] = [];
  server = fakeAisstream("reply", subs);
  const events = collect(`ws://localhost:${server.port}`);
  await until(() => events.some((e) => e.kind === "message"));

  const open = events.find((e) => e.kind === "open");
  expect(open?.kind === "open" && open.extensions).toContain("permessage-deflate");
  expect(subs[0]).toMatchObject({ APIKey: "test-key", BoundingBoxes: [[[35.7, -6.2], [36.3, -5.0]]] });
  const msg = events.find((e) => e.kind === "message");
  expect(msg?.kind === "message" && msg.data).toEqual({
    MessageType: "PositionReport",
    MetaData: { MMSI: 224000001 },
  });
});

test("reports aisstream errors and reconnects after the server closes", async () => {
  server = fakeAisstream("reject", []);
  const events = collect(`ws://localhost:${server.port}`);
  await until(() => events.filter((e) => e.kind === "open").length >= 2);

  expect(events).toContainEqual({ kind: "error", detail: "aisstream: Api Key Is Not Valid" });
  expect(events.some((e) => e.kind === "close")).toBe(true);
});

test("reconnects when an open socket goes silent", async () => {
  server = fakeAisstream("silent", []);
  const events = collect(`ws://localhost:${server.port}`, { stallMs: 200 });
  await until(() => events.filter((e) => e.kind === "open").length >= 2);

  expect(events).toContainEqual({ kind: "error", detail: "no messages for 0.2 s" });
  // The close reason is not echoed back to the client that closed, only the code.
  expect(events.some((e) => e.kind === "close" && e.code === 4000)).toBe(true);
});
