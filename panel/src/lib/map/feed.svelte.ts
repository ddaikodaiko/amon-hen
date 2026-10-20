import type { Confidence, Meta, StreamEvents, VerdictValue, VesselTick } from "../api.ts";

// The panel's side of GET /api/stream. In replay the clock lives in the connection: changing speed
// reconnects at the time on screen, and so does a dropped connection (EventSource would retry
// from the start of the recording).

/** A gap on the map: where and who, and the AI's verdict once there is one. */
export type Mark = StreamEvents["candidate"] & {
  verdict: VerdictValue | null;
  confidence: Confidence | null;
};

/** Gap marks older than this leave the map, as on the server. */
const MARKS_MS = 24 * 3_600_000;
const RETRY_MS = 2_000;

export class Feed {
  mode = $state<Meta["mode"] | null>(null);
  /** The data time on screen. */
  t = $state<number | null>(null);
  speed = $state<number | null>(null);
  range = $state<{ start: number; end: number } | null>(null);
  connected = $state(false);
  vessels = $state.raw<VesselTick[]>([]);
  marks = $state.raw<Mark[]>([]);
  health = $state.raw<StreamEvents["health"] | null>(null);

  private source: EventSource | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private readonly byId = new Map<number, Mark>();

  connect(opts: { at?: number; speed?: number } = {}): void {
    this.close();
    const q = new URLSearchParams();
    if (opts.at !== undefined) q.set("at", String(Math.round(opts.at)));
    if (opts.speed !== undefined) q.set("speed", String(opts.speed));
    const es = new EventSource(`/api/stream${q.size > 0 ? `?${q}` : ""}`);
    this.source = es;
    const on = <K extends keyof StreamEvents>(kind: K, handle: (data: StreamEvents[K]) => void) =>
      es.addEventListener(kind, (e) => handle(JSON.parse((e as MessageEvent<string>).data) as StreamEvents[K]));

    on("hello", (d) => {
      this.mode = d.mode;
      this.t = d.t;
      this.speed = d.speed;
      this.range = d.range;
      this.clearMarks();
    });
    on("positions", (d) => {
      this.t = d.t;
      this.vessels = d.vessels;
      this.expireMarks(d.t);
    });
    on("candidate", (d) => {
      this.byId.set(d.id, { ...d, verdict: null, confidence: null });
      this.marks = [...this.byId.values()];
    });
    on("dossier", (d) => {
      const m = this.byId.get(d.candidate_id);
      if (m === undefined) return;
      this.byId.set(m.id, { ...m, verdict: d.verdict, confidence: d.confidence });
      this.marks = [...this.byId.values()];
    });
    on("health", (d) => (this.health = d));
    on("reset", () => this.clearMarks());
    es.onopen = () => (this.connected = true);
    es.onerror = () => {
      this.connected = false;
      if (this.mode !== "replay") return; // live: EventSource retries by itself
      es.close();
      this.retry = setTimeout(() => this.connect({ at: this.t ?? undefined, speed: this.speed ?? undefined }), RETRY_MS);
    };
  }

  /** Replay only: the same moment, at another speed. */
  setSpeed(speed: number): void {
    this.connect({ at: this.t ?? undefined, speed });
  }

  close(): void {
    clearTimeout(this.retry);
    this.source?.close();
    this.source = null;
    this.connected = false;
  }

  private clearMarks(): void {
    this.byId.clear();
    this.marks = [];
  }

  private expireMarks(t: number): void {
    let gone = false;
    for (const [id, m] of this.byId) {
      if (m.gap_start < t - MARKS_MS) {
        this.byId.delete(id);
        gone = true;
      }
    }
    if (gone) this.marks = [...this.byId.values()];
  }
}
