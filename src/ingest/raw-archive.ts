import {
  appendFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

export type ArchiveLine =
  | { t: number; m: unknown }
  | { t: number; ev: "open" | "close" | "error"; detail?: string };

/** data/raw/YYYY-MM-DD/HH.ndjson, in UTC. */
export function hourFile(root: string, t: number): string {
  const iso = new Date(t).toISOString();
  return join(root, iso.slice(0, 10), `${iso.slice(11, 13)}.ndjson`);
}

export async function compressHour(path: string): Promise<void> {
  if (!existsSync(path)) return;
  const gz = `${path}.gz`;
  const tmp = `${gz}.tmp`;
  await pipeline(createReadStream(path), createGzip(), createWriteStream(tmp));
  if (existsSync(gz)) {
    // A restart can leave a second chunk of an hour already compressed; gzip members concatenate.
    appendFileSync(gz, readFileSync(tmp));
    unlinkSync(tmp);
  } else {
    renameSync(tmp, gz);
  }
  unlinkSync(path);
}

/**
 * Hourly NDJSON archive of everything received. The current hour stays plain text
 * (appendable after a restart) and is gzipped when the next hour starts.
 */
export class RawArchive {
  bytesWritten = 0;
  private lines: string[] = [];
  private file: string | null = null;
  private compressing: Promise<void> = Promise.resolve();

  constructor(private readonly root: string) {}

  /** Compresses hours a previous run left uncompressed, except the current one. */
  async init(now = Date.now()): Promise<void> {
    if (!existsSync(this.root)) return;
    const current = hourFile(this.root, now);
    for (const day of readdirSync(this.root, { withFileTypes: true })) {
      if (!day.isDirectory()) continue;
      const dir = join(this.root, day.name);
      for (const name of readdirSync(dir).sort()) {
        const path = join(dir, name);
        if (name.endsWith(".gz.tmp")) unlinkSync(path);
        else if (name.endsWith(".ndjson") && path !== current) await compressHour(path);
      }
    }
  }

  write(line: ArchiveLine): void {
    const file = hourFile(this.root, line.t);
    if (file !== this.file) this.rotate(file);
    this.lines.push(`${JSON.stringify(line)}\n`);
    if (this.lines.length >= 1000) this.flush();
  }

  flush(): void {
    if (this.file === null || this.lines.length === 0) return;
    const chunk = this.lines.join("");
    this.lines = [];
    appendFileSync(this.file, chunk);
    this.bytesWritten += Buffer.byteLength(chunk);
  }

  async close(): Promise<void> {
    this.flush();
    await this.compressing;
  }

  private rotate(next: string): void {
    this.flush();
    const previous = this.file;
    this.file = next;
    mkdirSync(dirname(next), { recursive: true });
    if (previous === null) return;
    this.compressing = this.compressing
      .then(() => compressHour(previous))
      .catch((err: unknown) => {
        // The next start retries it in init().
        console.error(`could not compress ${previous}: ${String(err)}`);
      });
  }
}
