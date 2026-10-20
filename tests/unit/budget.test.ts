import { describe, expect, test } from "bun:test";
import { canSpend, costUsd, monthOf, record, spentIn, worstCaseUsd } from "../../src/agent/budget";
import { loadConfig } from "../../src/config";
import { openDb } from "../../src/db";

const { local, haiku, sonnet } = loadConfig({}).profiles;
const OCT = Date.UTC(2026, 9, 20, 12);
const NOV = Date.UTC(2026, 10, 1, 0, 0, 1);

describe("cost", () => {
  test("from usage and the profile's prices, never from the model", () => {
    expect(costUsd({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, sonnet)).toBeCloseTo(12, 10);
    expect(costUsd({ input_tokens: 20_000, output_tokens: 2_000 }, haiku)).toBeCloseTo(0.003, 10);
    expect(costUsd({ input_tokens: 20_000, output_tokens: 2_000 }, local)).toBe(0);
  });

  test("the worst case of a call counts all of max_tokens as output", () => {
    expect(worstCaseUsd(haiku, 10_000, 4_000)).toBeCloseTo(0.001 + 0.002, 10);
  });
});

describe("monthly cap", () => {
  test("a cap of 0 blocks everything paid", () => {
    const db = openDb(":memory:");
    expect(canSpend(db, haiku, 0.000001, 0, OCT)).toBe(false);
    expect(canSpend(db, sonnet, 0.000001, 0, OCT)).toBe(false);
  });

  test("the local profile is never blocked, whatever the cap or the spending", () => {
    const db = openDb(":memory:");
    record(db, 50, 10, OCT);
    expect(canSpend(db, local, 1000, 0, OCT)).toBe(true);
  });

  test("a paid call goes ahead only if its worst case still fits under the cap", () => {
    const db = openDb(":memory:");
    record(db, 9.5, 10, OCT);
    expect(canSpend(db, haiku, 0.5, 10, OCT)).toBe(true);
    expect(canSpend(db, haiku, 0.51, 10, OCT)).toBe(false);
  });

  test("spending adds up by month, and a new month starts from zero", () => {
    const db = openDb(":memory:");
    record(db, 0.25, 10, OCT);
    record(db, 0.5, 10, OCT);
    expect(spentIn(db, monthOf(OCT))).toBeCloseTo(0.75, 10);
    expect(spentIn(db, monthOf(NOV))).toBe(0);
    expect(canSpend(db, haiku, 10, 10, NOV)).toBe(true);
    expect(monthOf(OCT)).toBe("2026-10");
  });

  test("a cost of 0 is not written down", () => {
    const db = openDb(":memory:");
    record(db, 0, 10, OCT);
    expect(db.query("SELECT 1 FROM budget").all()).toHaveLength(0);
  });
});
