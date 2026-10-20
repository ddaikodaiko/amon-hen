import { queued, transition } from "../agent/queue";
import type { NarrativeOutcome } from "../brief/narrative";
import type { CoverageJob, CoverageResult } from "../coverage/worker";
import type { Database } from "../db";
import { type DetectorRun, runDetector } from "../detect/run";
import type { Port } from "../geo/polygons";
import { healthClosedUntil } from "../ingest/health";
import type { Investigator } from "./investigator";
import type { ModelStatus } from "./model-status";

// What the server does on its own in live mode (T062): the detector every minute, the coverage
// every hour, and a worker that hands the queue to the investigator while the model answers. While
// it does not, the new cases wait for it, keeping their place (FR-028). With the queue empty, the
// worker also has the model write the paragraphs of the briefs still without one (R11).

export const DETECT_EVERY_MS = 60_000;
export const COVERAGE_EVERY_MS = 3_600_000;
/** The automatic investigations run with the default model; escalation follows the configuration. */
const AUTO_PROFILE = "local";

export interface JobsDeps {
  db: Database;
  investigator: Investigator;
  model: ModelStatus;
  /** Recomputes the coverage of the 7 days before `windowEnd`. */
  coverage: (windowEnd: number) => Promise<{ cells: number }>;
  /** Writes the paragraph of the brief of that date (narrative.ts). */
  narrate?: (date: string) => Promise<NarrativeOutcome>;
  ports?: Port[];
  now?: () => number;
  log?: (msg: string) => void;
}

/** The coverage recompute in a Worker thread, over its own connection to `dbPath`. */
export function coverageInWorker(dbPath: string): JobsDeps["coverage"] {
  return (windowEnd) =>
    new Promise((resolve, reject) => {
      const worker = new Worker(new URL("../coverage/worker.ts", import.meta.url).href);
      worker.onmessage = (e: MessageEvent<CoverageResult>) => {
        worker.terminate();
        if (e.data.ok) resolve({ cells: e.data.cells });
        else reject(new Error(e.data.error));
      };
      worker.onerror = (e) => {
        worker.terminate();
        reject(new Error(e.message));
      };
      worker.postMessage({ dbPath, windowEnd } satisfies CoverageJob);
    });
}

export class LiveJobs {
  private readonly now: () => number;
  private readonly log: (msg: string) => void;
  private narrating: Promise<void> | null = null;

  constructor(private readonly d: JobsDeps) {
    this.now = d.now ?? Date.now;
    this.log = d.log ?? (() => {});
  }

  detect(): DetectorRun {
    const run = runDetector(this.d.db, this.now(), { ports: this.d.ports });
    if (run.created + run.triggered + run.reopened > 0) {
      this.log(`detector: ${run.created} new gaps (${run.discarded} discarded), ${run.triggered} ready, ${run.reopened} back after the 6 h trigger`);
    }
    return run;
  }

  /**
   * With the model answering, hands every queued case to the investigator in order of arrival
   * (it ignores the ones it has already); without it, moves the new ones to waiting for it.
   * Returns how many were handed over.
   */
  work(): number {
    const { available } = this.d.model.state;
    if (available === null) return 0;
    const db = this.d.db;
    if (!available) {
      const fresh = db.query<{ id: number }, []>("SELECT id FROM candidates WHERE state = 'pending' ORDER BY trigger_at, id").all();
      for (const { id } of fresh) transition(db, id, "pending_no_model", this.now());
      if (fresh.length > 0) this.log(`${fresh.length} cases wait for the model: ${this.d.model.state.reason}`);
      return 0;
    }
    const ids = queued(db);
    for (const id of ids) this.d.investigator.enqueue(id, AUTO_PROFILE);
    if (ids.length === 0 && !this.d.investigator.busy) this.narrate();
    return ids.length;
  }

  /** The oldest brief still waiting for its paragraph, one at a time. */
  private narrate(): void {
    const narrate = this.d.narrate;
    if (narrate === undefined || this.narrating !== null) return;
    const date = this.d.db
      .query<{ date: string }, []>("SELECT date FROM briefs WHERE narrative_state = 'pending' ORDER BY date LIMIT 1")
      .get()?.date;
    if (date === undefined) return;
    this.narrating = narrate(date)
      .then((out) => this.log(`brief ${date}: ${out.state === "done" ? "paragraph written" : out.state}${"reason" in out ? ` (${out.reason})` : ""}`))
      .catch((err: unknown) => this.log(`brief ${date}: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => (this.narrating = null));
  }

  /** Resolves when the paragraph being written, if any, is done. */
  async settled(): Promise<void> {
    await this.narrating;
  }

  tick(): void {
    try {
      this.detect();
      this.work();
    } catch (err) {
      this.log(`jobs: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async coverage(): Promise<void> {
    const end = healthClosedUntil(this.d.db) ?? this.now();
    const t0 = performance.now();
    try {
      const { cells } = await this.d.coverage(end);
      this.log(`coverage: ${cells} cell-hours in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    } catch (err) {
      this.log(`coverage failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Starts the model check and the timers; returns the function that stops them. */
  start(): () => void {
    const stopModel = this.d.model.start();
    void this.coverage();
    const detect = setInterval(() => this.tick(), DETECT_EVERY_MS);
    const coverage = setInterval(() => void this.coverage(), COVERAGE_EVERY_MS);
    return () => {
      stopModel();
      clearInterval(detect);
      clearInterval(coverage);
    };
  }
}
