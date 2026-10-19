import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { hourFile, RawArchive } from "../../src/ingest/raw-archive";

const H10 = Date.UTC(2026, 9, 19, 10, 59, 59);
const H11 = Date.UTC(2026, 9, 19, 11, 0, 1);

function readLines(path: string): unknown[] {
  const text = path.endsWith(".gz") ? gunzipSync(readFileSync(path)).toString() : readFileSync(path, "utf8");
  return text
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "vigia-raw-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("RawArchive", () => {
  test("names files by UTC day and hour", () => {
    expect(hourFile("data/raw", H10)).toBe(join("data/raw", "2026-10-19", "10.ndjson"));
  });

  test("gzips the previous hour when the next one starts", async () => {
    const archive = new RawArchive(root);
    archive.write({ t: H10, m: { n: 1 } });
    archive.write({ t: H10, ev: "open" });
    archive.write({ t: H11, m: { n: 2 } });
    await archive.close();

    const h10 = hourFile(root, H10);
    expect(existsSync(h10)).toBe(false);
    expect(readLines(`${h10}.gz`)).toEqual([{ t: H10, m: { n: 1 } }, { t: H10, ev: "open" }]);
    expect(readLines(hourFile(root, H11))).toEqual([{ t: H11, m: { n: 2 } }]);
  });

  test("appends to the current hour after a restart", async () => {
    const first = new RawArchive(root);
    first.write({ t: H11, m: { n: 1 } });
    await first.close();

    const second = new RawArchive(root);
    await second.init(H11);
    second.write({ t: H11 + 1000, m: { n: 2 } });
    await second.close();

    expect(readLines(hourFile(root, H11))).toHaveLength(2);
  });

  test("init compresses hours a previous run left behind", async () => {
    const first = new RawArchive(root);
    first.write({ t: H10, m: { n: 1 } });
    await first.close();

    await new RawArchive(root).init(H11);

    const h10 = hourFile(root, H10);
    expect(existsSync(h10)).toBe(false);
    expect(readLines(`${h10}.gz`)).toEqual([{ t: H10, m: { n: 1 } }]);
  });

  test("a second chunk of an already compressed hour becomes another gzip member", async () => {
    const first = new RawArchive(root);
    first.write({ t: H10, m: { n: 1 } });
    first.write({ t: H11, m: { n: 2 } });
    await first.close();

    const late = new RawArchive(root);
    late.write({ t: H10, m: { n: 3 } });
    await late.close();
    await new RawArchive(root).init(H11);

    expect(readLines(`${hourFile(root, H10)}.gz`)).toEqual([
      { t: H10, m: { n: 1 } },
      { t: H10, m: { n: 3 } },
    ]);
  });
});
