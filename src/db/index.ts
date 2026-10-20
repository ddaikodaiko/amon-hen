import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import startedAt from "./migrations/002-started-at.sql" with { type: "text" };
import schemaV1 from "./schema.sql" with { type: "text" };

export type { Database };

/** One entry per schema version; index 0 takes the database from version 0 to 1. */
const MIGRATIONS: string[] = [schemaV1, startedAt];

export const SCHEMA_VERSION = MIGRATIONS.length;

/**
 * Opens (or creates) the database. Ingest and server write at the same time,
 * hence WAL and a busy timeout.
 */
export function openDb(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA synchronous = NORMAL");
  db.run("PRAGMA busy_timeout = 5000");
  db.run("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

/** Opens a shipped database (the demo) without writing to it; it must have this code's schema. */
export function openReadOnly(path: string): Database {
  const db = new Database(path, { readonly: true, strict: true });
  const version = db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0;
  if (version !== SCHEMA_VERSION) {
    db.close();
    throw new Error(`${path} has schema version ${version}, this code expects ${SCHEMA_VERSION}: rebuild it`);
  }
  return db;
}

export function migrate(db: Database): void {
  const current = db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.run(MIGRATIONS[v]!);
      db.run(`PRAGMA user_version = ${v + 1}`);
    })();
  }
}

export function getMeta(db: Database, key: string): string | null {
  return db.query<{ value: string }, [string]>("SELECT value FROM meta WHERE key = ?").get(key)?.value ?? null;
}

export function setMeta(db: Database, key: string, value: string): void {
  db.query("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(
    key,
    value,
  );
}
