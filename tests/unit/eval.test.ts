import { describe, expect, test } from "bun:test";
import { confusion, costs, type Judged, scores } from "../../src/eval/metrics";
import { naiveDark } from "../../src/eval/naive";
import { stopping } from "../../src/eval/stopping";
import { wilson } from "../../src/eval/wilson";

const MIN = 60_000;

describe("Wilson interval", () => {
  test("8 of 10: [0.490, 0.943]", () => {
    const i = wilson(8, 10)!;
    expect(i.p).toBe(0.8);
    expect(i.low).toBeCloseTo(0.49, 3);
    expect(i.high).toBeCloseTo(0.943, 3);
  });

  test("stays inside [0, 1] at the edges, and is null with no cases", () => {
    expect(wilson(0, 5)).toMatchObject({ p: 0, low: 0 });
    expect(wilson(5, 5)!.high).toBe(1);
    expect(wilson(0, 5)!.high).toBeGreaterThan(0.4);
    expect(wilson(0, 0)).toBeNull();
  });
});

describe("confusion matrix", () => {
  const cases: Judged[] = [
    { label: "likely_dark", dark: true },
    { label: "likely_dark", dark: true },
    { label: "likely_dark", dark: false },
    { label: "coverage_gap", dark: true },
    { label: "coverage_gap", dark: false },
    { label: "coverage_gap", dark: false },
    { label: "undeterminable", dark: true },
    { label: "undeterminable", dark: false },
  ];

  test("likely_dark against the rest, without the undeterminable ones", () => {
    expect(confusion(cases)).toEqual({ tp: 2, fp: 1, fn: 1, tn: 2 });
  });

  test("precision and recall with their intervals, and the undeterminable counted apart", () => {
    const s = scores(cases);
    expect(s.precision!.p).toBeCloseTo(2 / 3, 10);
    expect(s.recall!.p).toBeCloseTo(2 / 3, 10);
    expect(s.precision!.low).toBeLessThan(2 / 3);
    expect(s.undeterminable).toBe(2);
  });

  test("nobody called likely_dark: no precision to give", () => {
    expect(scores([{ label: "coverage_gap", dark: false }]).precision).toBeNull();
  });
});

describe("the 60-minute rule", () => {
  const gaps = [
    { gap_start: 0, gap_end: 45 * MIN },
    { gap_start: 0, gap_end: 60 * MIN },
    { gap_start: 0, gap_end: 61 * MIN },
    { gap_start: 0, gap_end: null },
  ];

  test("more than 60 minutes, or still open, is likely_dark", () => {
    expect(gaps.map(naiveDark)).toEqual([false, false, true, true]);
  });

  test("gives the same twice", () => {
    expect(gaps.map(naiveDark)).toEqual(gaps.map(naiveDark));
  });
});

describe("stopping rule", () => {
  test("99 cases: not enough", () => {
    expect(stopping(99, 40)).toEqual({ met: false, status: "insufficient", missing_cases: 1, missing_positives: 0 });
  });

  test("100 cases with 14 positives: not enough", () => {
    expect(stopping(100, 14)).toEqual({ met: false, status: "insufficient", missing_cases: 0, missing_positives: 1 });
  });

  test("100 cases with 15 positives: enough", () => {
    expect(stopping(100, 15)).toMatchObject({ met: true, status: "enough" });
  });

  test("300 cases without 15 positives: published, saying positives are rare", () => {
    expect(stopping(300, 9)).toEqual({ met: true, status: "rare_positives", missing_cases: 0, missing_positives: 6 });
  });
});

describe("costs", () => {
  test("mean per case, and per profile", () => {
    const c = costs([
      { profile: "local", cost_usd: 0 },
      { profile: "local", cost_usd: 0 },
      { profile: "haiku", cost_usd: 0.003 },
      { profile: "haiku", cost_usd: 0.005 },
    ]);
    expect(c.mean_usd_per_case).toBeCloseTo(0.002, 10);
    expect(c.by_profile.local).toEqual({ cases: 2, mean_usd: 0 });
    expect(c.by_profile.haiku!.mean_usd).toBeCloseTo(0.004, 10);
    expect(costs([]).mean_usd_per_case).toBeNull();
  });
});
