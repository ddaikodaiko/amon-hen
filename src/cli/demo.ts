import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { loadConfig, PORT } from "../config";
import { openReadOnly } from "../db";
import { recordedRange } from "../replay/clock";
import { PANEL_DIR, serve } from "../server/serve";

// bun run demo: the recorded demo in replay, with nothing else. No keys, no network, and no .env
// either: whatever the local configuration says, this is replay over demo/vigia-demo.sqlite.

const DEMO_DB = new URL("../../demo/vigia-demo.sqlite", import.meta.url).pathname;
const { values: args } = parseArgs({ options: { db: { type: "string", default: DEMO_DB } } });
const dbPath = args.db!;

if (!existsSync(dbPath)) {
  console.error(`${dbPath} is not there. It is built with: bun run demo:build --from <ISO> --to <ISO>`);
  process.exit(1);
}
if (!existsSync(`${PANEL_DIR}/index.html`)) {
  console.log("Building the panel (once)…");
  const build = Bun.spawnSync(["bun", "run", "build"], { cwd: new URL("../../panel", import.meta.url).pathname, stdout: "inherit", stderr: "inherit" });
  if (build.exitCode !== 0) {
    console.error("The panel did not build. Did `bun install` run?");
    process.exit(1);
  }
}

const db = openReadOnly(dbPath);
const range = recordedRange(db);
if (range === null) {
  console.error(`${dbPath} has no positions to replay`);
  process.exit(1);
}
const config = loadConfig({ VIGIA_MODE: "replay", VIGIA_DB: dbPath });
try {
  serve({ db, config, mode: "replay" });
} catch (err) {
  console.error(`Could not listen on port ${PORT}: ${err instanceof Error ? err.message : String(err)}. Is another Vigía running?`);
  process.exit(1);
}
const hours = ((range.end - range.start) / 3_600_000).toFixed(1);
console.log(`Vigía demo: ${hours} h of the Gulf of Finland from ${new Date(range.start).toISOString().slice(0, 16)} UTC, replayed at 60×.`);
console.log(`Open http://localhost:${PORT}`);
