import { type Config, type Mode, PORT } from "../config";
import type { Database } from "../db";
import { createApp } from "./app";
import type { Investigator } from "./investigator";
import type { ModelStatus } from "./model-status";

export const PANEL_DIR = new URL("../../panel/build", import.meta.url).pathname;

export interface ServeOptions {
  db: Database;
  config: Config;
  mode: Mode;
  investigator?: Investigator;
  model?: ModelStatus;
}

/** Starts the HTTP server: API, SSE and the built panel. */
export function serve(o: ServeOptions): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    port: PORT,
    // Live is local only; replay and public are meant to be reached from elsewhere.
    hostname: o.mode === "live" ? "127.0.0.1" : "0.0.0.0",
    // The SSE stream sends every second; this only closes connections that went quiet.
    idleTimeout: 30,
    fetch: createApp({ db: o.db, config: o.config, mode: o.mode, investigator: o.investigator, model: o.model }, { panelDir: PANEL_DIR }),
  });
}
