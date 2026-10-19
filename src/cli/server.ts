import { loadConfig, PORT } from "../config";
import { openDb } from "../db";
import { createApp } from "../server/app";

const config = loadConfig();
const mode = config.mode ?? "live";
const db = openDb(config.dbPath);

const server = Bun.serve({
  port: PORT,
  // Live is local only; replay and public are meant to be reached from elsewhere.
  hostname: mode === "live" ? "127.0.0.1" : "0.0.0.0",
  fetch: createApp({ db, config, mode, modelAvailable: () => null }, { panelDir: "panel/build" }),
});

console.log(`${new Date().toISOString()} vigía ${mode} on http://${server.hostname}:${server.port} (db ${config.dbPath})`);
