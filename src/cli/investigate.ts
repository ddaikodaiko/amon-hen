import { parseArgs } from "node:util";
import { AnthropicClient } from "../agent/model";
import { investigate } from "../agent/investigate";
import { recoverInterrupted, TransitionError, waiting } from "../agent/queue";
import { loadConfig, PROFILE_NAMES, type ProfileName } from "../config";
import { computeCoverage } from "../coverage/compute";
import { openDb } from "../db";
import { runDetector } from "../detect/run";
import { healthClosedUntil } from "../ingest/health";
import { escalationOf } from "../server/investigator";

// bun run investigate [--ids 1,2] [--all-pending] --profile local|haiku|sonnet
// Brings the detector and the coverage up to date, then investigates those candidates, or all the
// waiting ones in order, within the monthly cap. For development and the model comparison.

function log(msg: string): void {
  console.log(`${new Date().toISOString()} ${msg}`);
}

const { values: args } = parseArgs({
  options: { ids: { type: "string" }, "all-pending": { type: "boolean" }, profile: { type: "string" } },
});
const profile = args.profile as ProfileName | undefined;
if (profile === undefined || !PROFILE_NAMES.includes(profile)) {
  console.error(`--profile is required: ${PROFILE_NAMES.join(" | ")}`);
  process.exit(2);
}
if ((args.ids === undefined) === (args["all-pending"] !== true)) {
  console.error("give either --ids 1,2 or --all-pending");
  process.exit(2);
}

const config = loadConfig();
const chosen = config.profiles[profile];
if (chosen.paid && chosen.apiKey === undefined) {
  console.error(`the ${profile} profile needs ANTHROPIC_API_KEY`);
  process.exit(2);
}
if (chosen.paid && config.budgetUsd === 0) log(`warning: VIGIA_BUDGET_USD is 0, so the ${profile} profile cannot spend anything`);
const db = openDb(config.dbPath);

const now = Date.now();
const recovered = recoverInterrupted(db, now);
if (recovered > 0) log(`${recovered} investigations cut off earlier go back to the queue`);
const found = runDetector(db, now);
const coverageEnd = healthClosedUntil(db) ?? now;
const { cells } = computeCoverage(db, coverageEnd);
log(`detector: ${found.created} new gaps, ${found.discarded} discarded, ${found.triggered} ready; coverage: ${cells} cell-hours`);

const ids = args.ids !== undefined ? args.ids.split(",").map((s) => Number(s.trim())) : waiting(db);
const escalateName = escalationOf(config, profile);
const escalate = escalateName === null ? null : new AnthropicClient(config.profiles[escalateName]);
const primary = new AnthropicClient(chosen);
log(`${ids.length} candidates with ${profile} (${chosen.model})${escalate === null ? "" : `, escalating to ${escalateName}`}`);

for (const id of ids) {
  const t0 = performance.now();
  try {
    const out = await investigate(db, id, { primary, escalate, profiles: config.profiles, capUsd: config.budgetUsd });
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    if (out.state === "investigated") {
      log(`#${id}: ${out.verdict.verdict} (${out.verdict.confidence})${out.escalated ? ", escalated" : ""} in ${secs} s, dossier ${out.dossierId}`);
      continue;
    }
    log(`#${id}: ${out.state}${"reason" in out ? `: ${out.reason}` : ""} after ${secs} s`);
    // Without the model, or without budget, the rest would end the same way.
    if (out.state === "pending_no_model" || out.state === "pending_budget") break;
  } catch (err) {
    if (!(err instanceof TransitionError)) throw err;
    log(`#${id}: skipped, ${err.message}`);
  }
}
db.close();
