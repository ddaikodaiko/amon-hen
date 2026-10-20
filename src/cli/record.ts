import { parseArgs } from "node:util";
import { loadConfig } from "../config";
import { openDb } from "../db";
import { type RecordingKind, record } from "../replay/record";

// bun run record --from <ISO> --to <ISO> --kind demo|eval --out <path>

const { values: args } = parseArgs({
  options: { from: { type: "string" }, to: { type: "string" }, kind: { type: "string" }, out: { type: "string" } },
});
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
if (args.kind !== "demo" && args.kind !== "eval") {
  console.error("--kind must be demo or eval");
  process.exit(2);
}
if (args.out === undefined) {
  console.error("--out is required");
  process.exit(2);
}

const config = loadConfig();
const db = openDb(config.dbPath);
const s = record(db, { from, to, kind: args.kind as RecordingKind, out: args.out });
db.close();
console.log(
  `${args.out}: ${s.positions} positions of ${s.vessels} vessels, ${s.candidates} candidates, ${s.dossiers} dossiers ` +
    `(${s.steps} steps), ${s.labels} labels, ${(s.bytes / 1e6).toFixed(1)} MB`,
);
