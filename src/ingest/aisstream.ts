export const AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream";

// Strait of Gibraltar (spec, Assumptions). aisstream takes [lat, lon] corner pairs.
export const REGION_BOX: [[number, number], [number, number]] = [
  [35.7, -6.2],
  [36.3, -5.0],
];

export const MESSAGE_TYPES = [
  "PositionReport",
  "StandardClassBPositionReport",
  "ExtendedClassBPositionReport",
  "ShipStaticData",
  "StaticDataReport",
] as const;

export function buildSubscription(apiKey: string) {
  return {
    APIKey: apiKey,
    BoundingBoxes: [REGION_BOX],
    FilterMessageTypes: [...MESSAGE_TYPES],
  };
}

export function backoffDelay(attempt: number, minMs: number, maxMs: number): number {
  return Math.min(maxMs, minMs * 2 ** attempt);
}

export type StreamEvent =
  | { kind: "open"; extensions: string }
  | { kind: "message"; receivedAt: number; data: unknown }
  | { kind: "close"; code: number; reason: string }
  | { kind: "error"; detail: string };

export interface StreamOptions {
  apiKey: string;
  onEvent: (ev: StreamEvent) => void;
  url?: string;
  /** Reconnect when an open socket goes this long without messages. */
  stallMs?: number;
  minBackoffMs?: number;
  maxBackoffMs?: number;
}

export interface Stream {
  stop(): void;
}

const decoder = new TextDecoder();

function decode(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return decoder.decode(data);
  if (ArrayBuffer.isView(data)) return decoder.decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  return null;
}

function serverError(data: unknown): string | null {
  if (typeof data !== "object" || data === null || !("error" in data)) return null;
  return String(data.error);
}

/** Keeps one subscription to aisstream alive, reconnecting with exponential backoff. */
export function connectStream(opts: StreamOptions): Stream {
  const url = opts.url ?? AISSTREAM_URL;
  const stallMs = opts.stallMs ?? 120_000;
  const minBackoffMs = opts.minBackoffMs ?? 1_000;
  const maxBackoffMs = opts.maxBackoffMs ?? 60_000;

  let ws: WebSocket | null = null;
  let attempt = 0;
  let stopped = false;
  let lastMessageAt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  const stallTimer = setInterval(
    () => {
      if (ws?.readyState === WebSocket.OPEN && Date.now() - lastMessageAt > stallMs) {
        opts.onEvent({ kind: "error", detail: `no messages for ${stallMs / 1000} s` });
        ws.close(4000, "stall");
      }
    },
    Math.min(10_000, stallMs / 2),
  );

  const open = () => {
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    ws = socket;
    let closed = false;

    socket.onopen = () => {
      lastMessageAt = Date.now();
      // aisstream drops connections that do not subscribe within 3 s.
      socket.send(JSON.stringify(buildSubscription(opts.apiKey)));
      opts.onEvent({ kind: "open", extensions: socket.extensions });
    };

    socket.onmessage = (e) => {
      const receivedAt = Date.now();
      lastMessageAt = receivedAt;
      const text = decode(e.data);
      if (text === null) {
        opts.onEvent({ kind: "error", detail: "message with unknown payload type" });
        return;
      }
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        opts.onEvent({ kind: "error", detail: `unparseable message: ${text.slice(0, 120)}` });
        return;
      }
      const error = serverError(data);
      if (error !== null) {
        opts.onEvent({ kind: "error", detail: `aisstream: ${error}` });
        return;
      }
      attempt = 0;
      opts.onEvent({ kind: "message", receivedAt, data });
    };

    socket.onerror = () => opts.onEvent({ kind: "error", detail: "websocket error" });

    socket.onclose = (e) => {
      if (closed) return;
      closed = true;
      if (ws === socket) ws = null;
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
      clearTimeout(reconnectTimer);
      ws?.close(1000, "shutdown");
    },
  };
}
