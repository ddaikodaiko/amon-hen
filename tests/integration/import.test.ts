import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/db";
import { fetchMetadata } from "../../src/ingest/digitraffic";
import { archiveFiles, importArchive } from "../../src/ingest/import";
import { RawArchive } from "../../src/ingest/raw-archive";

const T0 = Date.UTC(2026, 9, 19, 12, 58, 0);
let dir = "";

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const location = (mmsi: number) => ({
  topic: `vessels-v2/${mmsi}/location`,
  data: { lat: 60.05, lon: 24.95, sog: 12, cog: 90, heading: 90, navStat: 0 },
});

/** 12:58 → 13:03, a message every 10 s, crossing an hour so one file is gzipped. */
async function writeArchive(): Promise<string> {
  dir = mkdtempSync(join(tmpdir(), "vigia-import-"));
  const archive = new RawArchive(dir);
  archive.write({
    t: T0,
    m: { topic: "vessels-v2/230000001/metadata", data: { name: "TESTER", imo: 9385831, draught: 80 } },
    src: "rest",
  });
  archive.write({ t: T0, ev: "open" });
  for (let s = 0; s < 5 * 60; s += 10) archive.write({ t: T0 + s * 1000, m: location(230000001) });
  archive.write({ t: T0 + 5 * 60_000, m: { topic: "vessels-v2/230000001/location", data: "{broken" } });
  await archive.close();
  return dir;
}

describe("import from the raw archive", () => {
  test("files come in time order, gzipped hours included", async () => {
    const root = await writeArchive();
    expect(archiveFiles(root).map((p) => p.slice(root.length + 1))).toEqual([
      "2026-10-19/12.ndjson.gz",
      "2026-10-19/13.ndjson",
    ]);
  });

  test("ends up as the live pipeline would: 30 s reduction, static data, health minutes", async () => {
    const db = openDb(":memory:");
    const stats = importArchive(db, await writeArchive());
    expect(stats.files).toBe(2);
    expect(stats.messages).toBe(32);
    expect(db.query("SELECT 1 FROM positions").all()).toHaveLength(10);
    expect(db.query<{ ais_class: string }, []>("SELECT ais_class FROM vessels").get()?.ais_class).toBe("A");
    // 6 messages a minute; the static data fetched at start does not count as stream traffic.
    expect(db.query<{ msg_count: number }, []>("SELECT msg_count FROM ingest_minutes ORDER BY minute_ts").all()[0]?.msg_count).toBe(6);
    expect(db.query("SELECT 1 FROM outages").all()).toHaveLength(0);
  });

  test("--from and --to limit the window", async () => {
    const db = openDb(":memory:");
    const stats = importArchive(db, await writeArchive(), { from: T0 + 60_000, to: T0 + 120_000 });
    expect(stats.messages).toBe(6);
    expect(stats.first).toBe(T0 + 60_000);
  });
});

describe("static data at start", () => {
  test("maps the REST format to MQTT metadata messages", async () => {
    const fakeFetch = async () =>
      Response.json([
        {
          mmsi: 667002320,
          name: "LERUO",
          callSign: "9LS2023",
          imo: 9385831,
          destination: "BRMAO",
          draught: 115,
          eta: 734336,
          shipType: 80,
          posType: 1,
          referencePointA: 150,
          referencePointB: 30,
          referencePointC: 22,
          referencePointD: 10,
          timestamp: 1792344115035,
        },
      ]);
    const [m] = await fetchMetadata(fakeFetch);
    expect(m?.topic).toBe("vessels-v2/667002320/metadata");
    expect(m?.data).toMatchObject({ callSign: "9LS2023", type: 80, refA: 150, refD: 10, imo: 9385831 });
  });

  test("an HTTP error is reported, not swallowed", async () => {
    await expect(fetchMetadata(async () => new Response("down", { status: 503 }))).rejects.toThrow("503");
  });
});
