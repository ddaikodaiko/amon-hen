import { describe, expect, test } from "bun:test";
import { ReplayClock } from "../../src/replay/clock";

const START = Date.UTC(2026, 9, 19, 6, 0);
const range = { start: START, end: START + 24 * 3_600_000 };

function wallClock() {
  let now = 1_000_000;
  return { wall: () => now, tick: (ms: number) => (now += ms) };
}

describe("replay clock", () => {
  test("at 60×, a minute of data passes in a second", () => {
    const w = wallClock();
    const clock = new ReplayClock(range, 60, START, w.wall);
    expect(clock.now()).toBe(START);
    w.tick(1000);
    expect(clock.now()).toBe(START + 60_000);
    w.tick(500);
    expect(clock.now()).toBe(START + 90_000);
  });

  test("changing speed does not make the clock jump", () => {
    const w = wallClock();
    const clock = new ReplayClock(range, 60, START, w.wall);
    w.tick(10_000);
    const before = clock.now();
    clock.setSpeed(300);
    expect(clock.now()).toBe(before);
    w.tick(1000);
    expect(clock.now()).toBe(before + 300_000);
    clock.setSpeed(1);
    w.tick(1000);
    expect(clock.now()).toBe(before + 301_000);
  });

  test("starts where it is asked to, inside the range", () => {
    const w = wallClock();
    expect(new ReplayClock(range, 10, START + 3_600_000, w.wall).now()).toBe(START + 3_600_000);
    expect(new ReplayClock(range, 10, START - 5, w.wall).now()).toBe(START);
  });

  test("at the end it starts over", () => {
    const w = wallClock();
    const clock = new ReplayClock(range, 300, range.end - 60_000, w.wall);
    w.tick(1000);
    expect(clock.now()).toBe(START + 240_000);
  });

  test("an empty range is refused", () => {
    expect(() => new ReplayClock({ start: START, end: START })).toThrow();
  });
});
