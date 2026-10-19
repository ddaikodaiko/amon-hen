import { hostname } from "node:os";
import {
  CONNACK,
  connectPacket,
  decodePublish,
  PacketReader,
  PINGREQ,
  PUBLISH,
  SUBACK,
  subscribePacket,
} from "./mqtt";

// Fintraffic's live AIS (CC BY 4.0, no key). Formats in research.md, R7.
export const DIGITRAFFIC_URL = "wss://meri.digitraffic.fi:443/mqtt";
export const TOPICS = ["vessels-v2/+/location", "vessels-v2/+/metadata"] as const;

export function backoffDelay(attempt: number, minMs: number, maxMs: number): number {
  return Math.min(maxMs, minMs * 2 ** attempt);
}

export type StreamEvent =
  | { kind: "open"; extensions: string }
  | { kind: "message"; receivedAt: number; topic: string; data: unknown }
  | { kind: "close"; code: number; reason: string }
  | { kind: "error"; detail: string };

export interface StreamOptions {
  onEvent: (ev: StreamEvent) => void;
  url?: string;
  clientId?: string;
  /** Reconnect when an open session goes this long without messages. */
  stallMs?: number;
  pingMs?: number;
  minBackoffMs?: number;
  maxBackoffMs?: number;
}

export interface Stream {
  stop(): void;
}

const decoder = new TextDecoder();

function toBytes(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return null;
}

/** Keeps one MQTT session with Digitraffic alive, reconnecting with exponential backoff. */
export function connectStream(opts: StreamOptions): Stream {
  const url = opts.url ?? DIGITRAFFIC_URL;
  const clientId = opts.clientId ?? `vigia-${hostname()}-${crypto.randomUUID().slice(0, 8)}`;
  const stallMs = opts.stallMs ?? 120_000;
  const pingMs = opts.pingMs ?? 30_000;
  const minBackoffMs = opts.minBackoffMs ?? 1_000;
  const maxBackoffMs = opts.maxBackoffMs ?? 60_000;

  let ws: WebSocket | null = null;
  let session = false;
  let attempt = 0;
  let stopped = false;
  let lastMessageAt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  const stallTimer = setInterval(
    () => {
      if (ws !== null && session && Date.now() - lastMessageAt > stallMs) {
        opts.onEvent({ kind: "error", detail: `no messages for ${stallMs / 1000} s` });
        ws.close(4000, "stall");
      }
    },
    Math.min(10_000, stallMs / 2),
  );

  const pingTimer = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(PINGREQ);
  }, pingMs);

  const open = () => {
    const socket = new WebSocket(url, ["mqtt"]);
    socket.binaryType = "arraybuffer";
    ws = socket;
    session = false;
    const reader = new PacketReader();
    let closed = false;

    socket.onopen = () => socket.send(connectPacket(clientId, Math.ceil((pingMs * 2) / 1000)));

    socket.onmessage = (e) => {
      const bytes = toBytes(e.data);
      if (bytes === null) {
        opts.onEvent({ kind: "error", detail: "non-binary frame" });
        return;
      }
      let packets;
      try {
        packets = reader.push(bytes);
      } catch (err) {
        opts.onEvent({ kind: "error", detail: String(err) });
        socket.close(4002, "protocol");
        return;
      }
      for (const p of packets) {
        if (p.type === CONNACK) {
          const code = p.body[1] ?? 255;
          if (code !== 0) {
            opts.onEvent({ kind: "error", detail: `connection refused, code ${code}` });
            socket.close(4001, "connack");
            return;
          }
          session = true;
          lastMessageAt = Date.now();
          socket.send(subscribePacket(1, TOPICS));
          opts.onEvent({ kind: "open", extensions: socket.extensions });
        } else if (p.type === SUBACK) {
          if (p.body.subarray(2).some((code) => code === 0x80)) {
            opts.onEvent({ kind: "error", detail: "subscription refused" });
          }
        } else if (p.type === PUBLISH) {
          const receivedAt = Date.now();
          lastMessageAt = receivedAt;
          const { topic, payload } = decodePublish(p);
          let data: unknown;
          try {
            data = JSON.parse(decoder.decode(payload));
          } catch {
            opts.onEvent({ kind: "error", detail: `unparseable payload on ${topic}` });
            continue;
          }
          attempt = 0;
          opts.onEvent({ kind: "message", receivedAt, topic, data });
        }
      }
    };

    socket.onerror = () => opts.onEvent({ kind: "error", detail: "websocket error" });

    socket.onclose = (e) => {
      if (closed) return;
      closed = true;
      if (ws === socket) {
        ws = null;
        session = false;
      }
      opts.onEvent({ kind: "close", code: e.code, reason: e.reason });
      if (stopped) return;
      reconnectTimer = setTimeout(open, backoffDelay(attempt++, minBackoffMs, maxBackoffMs));
    };
  };

  open();

  return {
    stop() {
      stopped = true;
      clearInterval(stallTimer);
      clearInterval(pingTimer);
      clearTimeout(reconnectTimer);
      ws?.close(1000, "shutdown");
    },
  };
}

export const DIGITRAFFIC_VESSELS_URL = "https://meri.digitraffic.fi/api/ais/v1/vessels";

interface RestVessel {
  mmsi: number;
  name?: string;
  callSign?: string;
  imo?: number;
  destination?: string;
  draught?: number;
  eta?: number;
  shipType?: number;
  posType?: number;
  referencePointA?: number;
  referencePointB?: number;
  referencePointC?: number;
  referencePointD?: number;
  timestamp?: number;
}

/**
 * The static data of every vessel Fintraffic knows, as MQTT metadata messages. The stream only
 * sends metadata when a vessel reports it, so right after a start most class A vessels would
 * look like class B (research.md, R7). Called once at start; failures are the caller's to log.
 */
export async function fetchMetadata(
  fetchFn: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<{ topic: string; data: unknown }[]> {
  const res = await fetchFn(DIGITRAFFIC_VESSELS_URL, {
    headers: { "Digitraffic-User": "vigia", "Accept-Encoding": "gzip" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`vessels metadata: HTTP ${res.status}`);
  const vessels = (await res.json()) as RestVessel[];
  return vessels.map((v) => ({
    topic: `vessels-v2/${v.mmsi}/metadata`,
    data: {
      name: v.name,
      callSign: v.callSign,
      imo: v.imo,
      destination: v.destination,
      draught: v.draught,
      eta: v.eta,
      type: v.shipType,
      posType: v.posType,
      refA: v.referencePointA,
      refB: v.referencePointB,
      refC: v.referencePointC,
      refD: v.referencePointD,
      timestamp: v.timestamp,
    },
  }));
}
