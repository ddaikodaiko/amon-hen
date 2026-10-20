import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { Database } from "../db";
import type { ArchiveLine } from "./raw-archive";
import { closeMinutes } from "./health";
import { parseMessage } from "./parse";
import { applyEvent, applyMessage, ingestRaw } from "./pipeline";

export interface ImportRange {
  from?: number;
  to?: number;
}

export interface ImportStats {
  files: number;
  messages: number;
  stored: number;
  first: number | null;
  last: number | null;
}

/** Archive files in time order. In an hour, the .gz (earlier runs) goes before the plain file. */
export function archiveFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const day of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    const names = readdirSync(join(root, day)).filter((n) => n.endsWith(".ndjson") || n.endsWith(".ndjson.gz"));
    names.sort((a, b) => a.slice(0, 2).localeCompare(b.slice(0, 2)) || (b.endsWith(".gz") ? 1 : 0) - (a.endsWith(".gz") ? 1 : 0));
    out.push(...names.map((n) => join(root, day, n)));
  }
  return out;
}

function readLines(path: string): string[] {
  const buf = readFileSync(path);
  // gunzipSync reads every gzip member, and a restart can leave two in one file.
  return (path.endsWith(".gz") ? gunzipSync(buf) : buf).toString("utf8").split("\n");
}

/**
 * Replays the raw archive through the same pipeline as the live ingest, so the database ends up
 * as if it had been recorded live. Meant for an empty database (counts would add up twice).
 */
export function importArchive(
  db: Database,
  root: string,
  range: ImportRange = {},
  onFile?: (path: string, stats: ImportStats) => void,
): ImportStats {
  const stats: ImportStats = { files: 0, messages: 0, stored: 0, first: null, last: null };
  const from = range.from ?? Number.NEGATIVE_INFINITY;
  const to = range.to ?? Number.POSITIVE_INFINITY;
  let minute = -1;

  for (const path of archiveFiles(root)) {
    db.transaction(() => {
      for (const raw of readLines(path)) {
        if (raw === "") continue;
        let line: ArchiveLine;
        try {
          line = JSON.parse(raw) as ArchiveLine;
        } catch {
          continue; // a line cut by a crash
        }
        if (line.t < from || line.t >= to) continue;
        const m = Math.floor(line.t / 60_000);
        if (m !== minute) {
          closeMinutes(db, line.t);
          minute = m;
        }
        stats.first ??= line.t;
        stats.last = line.t;
        if ("m" in line) {
          const { topic, data } = line.m as { topic: string; data: unknown };
          stats.messages++;
          if (line.src === "rest") {
            const msg = parseMessage(topic, data, line.t);
            if (msg !== null && applyMessage(db, msg)) stats.stored++;
          } else if (ingestRaw(db, topic, data, line.t)) stats.stored++;
        } else if (line.ev === "open" || line.ev === "close") {
          applyEvent(db, { kind: line.ev, ts: line.t });
        }
      }
    }).immediate();
    stats.files++;
    onFile?.(path, stats);
  }
  return stats;
}
