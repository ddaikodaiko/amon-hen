import { parseArgs } from "node:util";
import { AnthropicClient } from "../agent/model";
import { loadConfig, PROFILE_NAMES, type ProfileName } from "../config";
import { openDb } from "../db";
import { buildReport, saveReport } from "../eval/report";
import { investigateLabeled } from "../eval/run";
import type { EvalScores, Interval } from "../shared/api";

// bun run eval [--profile local|haiku|sonnet] [--fresh]
// With a profile, investigates the labelled cases again with it, on its own and within the monthly
// cap; a case that already has a dossier of that exact agent version is not asked again unless
// --fresh. Without one, takes each case's newest dossier. Saves the report and prints it.

function log(msg: string): void {
  console.log(`${new Date().toISOString()} ${msg}`);
}

const { values: args } = parseArgs({ options: { profile: { type: "string" }, fresh: { type: "boolean" } } });
const profile = args.profile as ProfileName | undefined;
if (profile !== undefined && !PROFILE_NAMES.includes(profile)) {
  console.error(`--profile must be one of ${PROFILE_NAMES.join(" | ")}`);
  process.exit(2);
}

const config = loadConfig();
const db = openDb(config.dbPath);
if (db.query("SELECT 1 FROM labels LIMIT 1").get() === null) {
  console.error("No labels yet: label cases at /label in the panel (bun run server) first.");
  process.exit(1);
}

let version: string | undefined;
if (profile !== undefined) {
  const chosen = config.profiles[profile];
  if (chosen.paid && chosen.apiKey === undefined) {
    console.error(`the ${profile} profile needs ANTHROPIC_API_KEY`);
    process.exit(2);
  }
  const run = await investigateLabeled(db, {
    client: new AnthropicClient(chosen),
    profiles: config.profiles,
    capUsd: config.budgetUsd,
    fresh: args.fresh,
    onCase: (done, total, outcome) => log(`${done}/${total} ${outcome}`),
  });
  version = run.agentVersion;
  log(`${profile}: ${run.investigated} investigated, ${run.reused} already done at this version, ${run.errors} errors`);
  if (run.stopped !== null) log(`stopped early: ${run.stopped}. The report covers what is done.`);
}

const report = buildReport(db, { profile: profile === undefined || version === undefined ? undefined : { name: profile, agentVersion: version } });
const id = saveReport(db, report);
db.close();

const m = report.metrics;
const pct = (i: Interval | null) => (i === null ? "—".padEnd(18) : `${i.p.toFixed(2)} [${i.low.toFixed(2)}, ${i.high.toFixed(2)}]`.padEnd(18));
const row = (name: string, s: EvalScores) =>
  `  ${name.padEnd(16)} ${pct(s.precision)} ${pct(s.recall)} ${[s.tp, s.fp, s.fn, s.tn].map((n) => String(n).padStart(4)).join("")}`;
const sample =
  m.stopping.status === "enough"
    ? "enough to publish"
    : m.stopping.status === "rare_positives"
      ? "300 cases reached: likely_dark is rare, publish saying so"
      : `INSUFFICIENT SAMPLE: ${m.stopping.missing_cases} more cases and ${m.stopping.missing_positives} more likely_dark needed`;
const costs = Object.entries(m.cost.by_profile)
  .map(([p, c]) => `${p} ${c.mean_usd.toFixed(4)} USD × ${c.cases}`)
  .join(", ");

console.log(`
Eval report #${id}, agent ${report.agent_version}${report.profile === null ? " (newest dossier of each case)" : ` (${report.profile})`}
Sample: ${report.n_labeled} labelled, ${report.n_positive} likely_dark, ${report.n_undeterminable} undeterminable (left out of the matrix): ${sample}

  ${"".padEnd(16)} ${"precision".padEnd(18)} ${"recall".padEnd(18)}   tp  fp  fn  tn
${row("agent", m.agent)}
${row("60-minute rule", m.naive)}
${m.not_investigated > 0 ? `\n  The agent has no dossier for ${m.not_investigated} labelled cases: it is measured on ${report.n_labeled - m.not_investigated}.\n` : ""}
Cost per case: ${m.cost.mean_usd_per_case === null ? "—" : `${m.cost.mean_usd_per_case.toFixed(4)} USD`}${costs === "" ? "" : ` (${costs})`}
Left out by the detector over the period: ${m.discarded.own_outage} our own outage, ${m.discarded.left_region} left the region, ${m.discarded.berth} at a berth
95 % Wilson intervals. The report is at /eval in the panel.`);
