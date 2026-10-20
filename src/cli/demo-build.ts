import { parseArgs } from "node:util";
import { AnthropicClient } from "../agent/model";
import { loadConfig } from "../config";
import { openDb } from "../db";
import { buildDemo, DemoBuildError } from "../replay/demo-build";
import { escalationOf } from "../server/investigator";

// bun run demo:build --from <ISO> --to <ISO> [--out demo/vigia-demo.sqlite]
// Investigates the window's cases that have no dossier yet (with the local model, escalating as
// configured), records the window as a demo and adds the briefs and eval reports. Needs the model.

const DEFAULT_OUT = "demo/vigia-demo.sqlite";
const { values: args } = parseArgs({ options: { from: { type: "string" }, to: { type: "string" }, out: { type: "string", default: DEFAULT_OUT } } });
const time = (name: string, v: string | undefined) => {
  const ts = v === undefined ? Number.NaN : Date.parse(/Z|[+-]\d\d:\d\d$/.test(v) ? v : `${v}Z`);
  if (Number.isNaN(ts)) {
    console.error(`--${name} must be an ISO date-time (UTC if no offset), e.g. 2026-10-19T18:00`);
    process.exit(2);
  }
  return ts;
};
const from = time("from", args.from);
const to = time("to", args.to);
if (to <= from) {
  console.error("--to must come after --from");
  process.exit(2);
}

function log(msg: string): void {
  console.log(`${new Date().toISOString()} ${msg}`);
}

const config = loadConfig();
const db = openDb(config.dbPath);
const escalate = escalationOf(config, "local");
try {
  const r = await buildDemo(db, {
    from,
    to,
    out: args.out!,
    investigate: {
      primary: new AnthropicClient(config.profiles.local),
      escalate: escalate === null ? null : new AnthropicClient(config.profiles[escalate]),
      profiles: config.profiles,
      capUsd: config.budgetUsd,
    },
    onCase: (id, outcome) => log(`#${id}: ${outcome}`),
  });
  log(
    `${args.out}: ${r.positions} positions, ${r.candidates} cases (${r.investigated} investigated now), ${r.dossiers} dossiers, ` +
      `${r.briefs} briefs, ${r.reports} eval reports, ${(r.bytes / 1e6).toFixed(1)} MB. Try it: bun run demo`,
  );
} catch (err) {
  if (!(err instanceof DemoBuildError)) throw err;
  console.error(err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
