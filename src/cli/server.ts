import { AnthropicClient } from "../agent/model";
import { recoverInterrupted } from "../agent/queue";
import { writeNarrative } from "../brief/narrative";
import { loadConfig } from "../config";
import { openDb } from "../db";
import { SerialInvestigator } from "../server/investigator";
import { coverageInWorker, LiveJobs } from "../server/jobs";
import { ModelStatus } from "../server/model-status";
import { serve } from "../server/serve";

function log(msg: string): void {
  console.log(`${new Date().toISOString()} ${msg}`);
}

const config = loadConfig();
const mode = config.mode ?? "live";
const db = openDb(config.dbPath);

// Only live investigates; replay and public are read-only (R13).
const investigator = mode === "live" ? new SerialInvestigator(db, config) : undefined;
const model = mode === "live" ? new ModelStatus(new AnthropicClient(config.profiles.local)) : undefined;
if (investigator !== undefined && model !== undefined) {
  const recovered = recoverInterrupted(db);
  if (recovered > 0) log(`${recovered} investigations cut off earlier go back to the queue`);
  const local = config.profiles.local;
  const narrate = (date: string) => writeNarrative(db, date, { client: new AnthropicClient(local), profile: local, capUsd: config.budgetUsd });
  new LiveJobs({ db, investigator, model, coverage: coverageInWorker(config.dbPath), narrate, log }).start();
}

const server = serve({ db, config, mode, investigator, model });
log(`vigía ${mode} on http://${server.hostname}:${server.port} (db ${config.dbPath})`);
