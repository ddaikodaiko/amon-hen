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
/** How much of each vessel's recent route the map draws behind it, in data time. */
const TRAIL_MS = 20 * 60_000;
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
  /** Each vessel's recent positions, [lon, lat], oldest first: the trails behind them. */
  trails = $state.raw<[number, number][][]>([]);
  health = $state.raw<StreamEvents["health"] | null>(null);

  private source: EventSource | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private readonly byId = new Map<number, Mark>();
  private readonly trailOf = new Map<number, [number, number, number][]>();

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
      this.trailOf.clear();
    });
    on("positions", (d) => {
      this.t = d.t;
      this.vessels = d.vessels;
      this.expireMarks(d.t);
      this.extendTrails(d.t, d.vessels);
    });
    on("candidate", (d) => {
      // Live sends a mark again when its vessel is back: it keeps the verdict it may have.
      const prev = this.byId.get(d.id);
      this.byId.set(d.id, { ...d, verdict: prev?.verdict ?? null, confidence: prev?.confidence ?? null });
      this.marks = [...this.byId.values()];
    });
    on("dossier", (d) => {
      const m = this.byId.get(d.candidate_id);
      if (m === undefined) return;
      this.byId.set(m.id, { ...m, verdict: d.verdict, confidence: d.confidence });
      this.marks = [...this.byId.values()];
    });
    on("health", (d) => (this.health = d));
    on("reset", () => {
      this.clearMarks();
      this.trailOf.clear();
    });
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

  /** A point per new position; vessels no longer heard from lose their trail. */
  private extendTrails(t: number, vessels: VesselTick[]): void {
    const heard = new Set<number>();
    for (const [mmsi, lat, lon] of vessels) {
      heard.add(mmsi);
      const trail = this.trailOf.get(mmsi) ?? [];
      const last = trail.at(-1);
      if (last === undefined || last[1] !== lon || last[2] !== lat) trail.push([t, lon, lat]);
      while (trail.length > 0 && trail[0]![0] < t - TRAIL_MS) trail.shift();
      this.trailOf.set(mmsi, trail);
    }
    for (const mmsi of this.trailOf.keys()) if (!heard.has(mmsi)) this.trailOf.delete(mmsi);
    this.trails = [...this.trailOf.values()].filter((tr) => tr.length > 1).map((tr) => tr.map(([, lon, lat]) => [lon, lat]));
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
