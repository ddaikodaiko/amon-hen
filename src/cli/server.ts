import { AnthropicClient } from "../agent/model";
import { recoverInterrupted } from "../agent/queue";
import { loadConfig } from "../config";
import { openDb } from "../db";
import { SerialInvestigator } from "../server/investigator";
import { ModelStatus } from "../server/model-status";
import { serve } from "../server/serve";

const config = loadConfig();
const mode = config.mode ?? "live";
const db = openDb(config.dbPath);

// Only live investigates; replay and public are read-only (R13).
const investigator = mode === "live" ? new SerialInvestigator(db, config) : undefined;
const model = mode === "live" ? new ModelStatus(new AnthropicClient(config.profiles.local)) : undefined;
model?.start();
if (investigator !== undefined) {
  const recovered = recoverInterrupted(db);
  if (recovered > 0) console.log(`${new Date().toISOString()} ${recovered} investigations cut off earlier go back to the queue`);
}

const server = serve({ db, config, mode, investigator, model });
console.log(`${new Date().toISOString()} vigía ${mode} on http://${server.hostname}:${server.port} (db ${config.dbPath})`);
