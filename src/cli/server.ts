import { recoverInterrupted } from "../agent/queue";
import { loadConfig, PORT } from "../config";
import { openDb } from "../db";
import { createApp } from "../server/app";
import { SerialInvestigator } from "../server/investigator";

const config = loadConfig();
const mode = config.mode ?? "live";
const db = openDb(config.dbPath);

// Only live investigates; replay and public are read-only (R13).
const investigator = mode === "live" ? new SerialInvestigator(db, config) : undefined;
if (investigator !== undefined) {
  const recovered = recoverInterrupted(db);
  if (recovered > 0) console.log(`${new Date().toISOString()} ${recovered} investigations cut off earlier go back to the queue`);
}

const server = Bun.serve({
  port: PORT,
  // Live is local only; replay and public are meant to be reached from elsewhere.
  hostname: mode === "live" ? "127.0.0.1" : "0.0.0.0",
  fetch: createApp({ db, config, mode, modelAvailable: () => null, investigator }, { panelDir: "panel/build" }),
});

console.log(`${new Date().toISOString()} vigía ${mode} on http://${server.hostname}:${server.port} (db ${config.dbPath})`);
