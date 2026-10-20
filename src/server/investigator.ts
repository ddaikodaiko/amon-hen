import { investigate } from "../agent/investigate";
import { AnthropicClient, type ModelClient } from "../agent/model";
import { type Config, PROFILE_NAMES, type Profile, type ProfileName } from "../config";
import type { Database } from "../db";

// Investigations asked for from the panel, one at a time in the order they were asked (FR-013).
// The queue lives in memory: a request lost in a restart is asked for again. The live-mode jobs
// (T062) feed the automatic cases through here as well.

export interface Investigator {
  /** Queues a case and returns its place: 1 is the one under way, or next. Queuing it again keeps its place. */
  enqueue(id: number, profile: ProfileName): number;
}

/** The profile to escalate to from `primary`, if the configured one is above it (FR-010). */
export function escalationOf(config: Config, primary: ProfileName): ProfileName | null {
  const to = config.escalateProfile;
  if (to === "none") return null;
  return PROFILE_NAMES.indexOf(to) > PROFILE_NAMES.indexOf(primary) ? to : null;
}

export class SerialInvestigator implements Investigator {
  private readonly queue: { id: number; profile: ProfileName }[] = [];
  private running: number | null = null;
  private drained: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: Database,
    private readonly config: Config,
    private readonly client: (p: Profile) => ModelClient = (p) => new AnthropicClient(p),
    private readonly now: () => number = Date.now,
  ) {}

  enqueue(id: number, profile: ProfileName): number {
    if (this.running !== id && !this.queue.some((j) => j.id === id)) this.queue.push({ id, profile });
    // drain() takes the first job before its first await, so the place below already counts it.
    if (this.running === null) this.drained = this.drain();
    return this.running === id ? 1 : this.queue.findIndex((j) => j.id === id) + (this.running === null ? 1 : 2);
  }

  /** Resolves when the queue is empty. */
  idle(): Promise<void> {
    return this.drained;
  }

  private async drain(): Promise<void> {
    for (let job = this.queue.shift(); job !== undefined; job = this.queue.shift()) {
      this.running = job.id;
      const escalate = escalationOf(this.config, job.profile);
      try {
        await investigate(this.db, job.id, {
          primary: this.client(this.config.profiles[job.profile]),
          escalate: escalate === null ? null : this.client(this.config.profiles[escalate]),
          profiles: this.config.profiles,
          capUsd: this.config.budgetUsd,
          now: this.now,
        });
      } catch (err) {
        console.error(`investigation of candidate ${job.id} failed`, err);
      }
    }
    this.running = null;
  }
}
