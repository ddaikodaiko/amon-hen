import type { ModelClient } from "../agent/model";

// Whether the default model answers, checked every 2 min in live mode (FR-026, FR-028). The panel
// shows it, and the queue worker (T062) waits on it.

export interface ModelState {
  /** Null until the first check. */
  available: boolean | null;
  reason: string | null;
}

export const CHECK_EVERY_MS = 2 * 60_000;

export class ModelStatus {
  private current: ModelState = { available: null, reason: null };

  constructor(private readonly client: ModelClient) {}

  get state(): ModelState {
    return this.current;
  }

  async check(): Promise<ModelState> {
    const reason = await this.client.unavailable();
    this.current = { available: reason === null, reason };
    return this.current;
  }

  /** Checks now and then every CHECK_EVERY_MS; returns the function that stops it. */
  start(everyMs = CHECK_EVERY_MS): () => void {
    void this.check();
    const timer = setInterval(() => void this.check(), everyMs);
    return () => clearInterval(timer);
  }
}
