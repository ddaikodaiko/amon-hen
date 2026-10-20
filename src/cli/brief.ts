import { parseArgs } from "node:util";
import { AnthropicClient } from "../agent/model";
import { writeNarrative } from "../brief/narrative";
import { generateBrief, zonedDate } from "../brief/sections";
import { loadConfig } from "../config";
import { openDb } from "../db";

// bun run brief [--date YYYY-MM-DD] [--no-narrative]
// Writes the day's brief (by default today's, Madrid time): the sections at once, and the model's
// paragraph if the model answers now. If not, the live server writes it when the model is back.
// deploy/vigia-brief.timer runs this at 08:00 Europe/Madrid.

const { values: args } = parseArgs({ options: { date: { type: "string" }, "no-narrative": { type: "boolean" } } });
const date = args.date ?? zonedDate(Date.now());
if (!/^\d{4}-\d\d-\d\d$/.test(date) || Number.isNaN(Date.parse(date))) {
  console.error("--date must be a date: YYYY-MM-DD");
  process.exit(2);
}

const config = loadConfig();
const db = openDb(config.dbPath);
const brief = generateBrief(db, config, date);
const s = brief.sections;
const iso = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ");
console.log(`Brief ${date}: ${iso(s.window.start)} to ${iso(s.window.end)} UTC`);
console.log(
  `  ${s.verdicts.cases} cases: ${s.verdicts.likely_dark} likely dark, ${s.verdicts.coverage_gap} coverage gaps, ${s.verdicts.inconclusive} inconclusive`,
);
for (const c of s.top) {
  console.log(`  #${c.id} ${c.name ?? `MMSI ${c.mmsi}`}: ${c.verdict} (${c.confidence}), ${c.duration_min === null ? "still silent" : `${c.duration_min} min`}`);
}
const waiting = s.waiting.pending + s.waiting.pending_no_model + s.waiting.pending_budget + s.waiting.error;
if (waiting > 0) console.log(`  ${waiting} cases still waiting`);
console.log(`  ingest: ${s.health.down} of ${s.health.minutes} minutes down, ${s.health.outages.length} outages · spent ${s.spend.day_usd.toFixed(4)} USD`);

if (brief.narrative_state === "skipped") {
  console.log("No case in these 24 h: no paragraph to write.");
} else if (!args["no-narrative"]) {
  const local = config.profiles.local;
  const out = await writeNarrative(db, date, { client: new AnthropicClient(local), profile: local, capUsd: config.budgetUsd });
  if (out.state === "done") console.log(`\n${out.text}`);
  else console.log(`The paragraph waits: ${"reason" in out ? out.reason : out.state}. The live server writes it when the model answers.`);
}
db.close();
