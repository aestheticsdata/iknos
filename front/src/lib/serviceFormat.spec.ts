import { describe, expect, it } from "vitest";
import {
  ABSENT,
  formatMs,
  formatPercent,
  formatPool,
  formatRate,
  formatUptime,
  hasSeries,
  loopTone,
  poolShare,
  poolTone,
} from "./serviceFormat";

/**
 * The service view's render-time arithmetic (IKN-13).
 *
 * These are the decisions that would be wrong in silence: a pool bar that turns red one connection
 * late, a rate that rounds a real trickle of traffic down to `0.0`, an uptime that calls 23 hours a
 * day. None of them fails, and all of them are read as facts.
 */

const NOW = Date.parse("2026-08-23T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("formatUptime", () => {
  it("gives days and hours for a long-running process", () => {
    expect(formatUptime(ago(6 * 86_400_000 + 4 * 3_600_000), NOW)).toBe("6d 04h");
  });

  it("gives hours and minutes below a day, rather than rounding 23 hours up to one", () => {
    expect(formatUptime(ago(23 * 3_600_000 + 40 * 60_000), NOW)).toBe("23h 40m");
  });

  it("gives minutes for a process that has just come back", () => {
    expect(formatUptime(ago(90_000), NOW)).toBe("1m");
  });

  it("says nothing when PM2 reported no start time", () => {
    expect(formatUptime(null, NOW)).toBe(ABSENT);
    expect(formatUptime("not a date", NOW)).toBe(ABSENT);
  });

  it("clamps a start time in the future rather than rendering a negative uptime", () => {
    // Two clocks disagreeing is not an uptime to draw with a minus sign in front of it.
    expect(formatUptime(new Date(NOW + 60_000).toISOString(), NOW)).toBe("0m");
  });
});

describe("formatRate", () => {
  it("keeps two decimals for the trickle most services on this box actually serve", () => {
    // One request every couple of minutes is 0.008/s. Rounded to one decimal it reads `0.0`, which
    // is the one thing this tile must not say about a service that is answering.
    expect(formatRate(0.008)).toBe("0.01");
  });

  it("keeps one decimal in the ordinary range and none once the digits are jitter", () => {
    expect(formatRate(4.23)).toBe("4.2");
    expect(formatRate(41.23)).toBe("41");
  });

  it("distinguishes a measured zero from an unknown", () => {
    expect(formatRate(0)).toBe("0");
    expect(formatRate(null)).toBe(ABSENT);
  });
});

describe("formatPercent", () => {
  it("keeps a decimal below ten and drops it above", () => {
    expect(formatPercent(1.83)).toBe("1.8");
    expect(formatPercent(31.4)).toBe("31");
  });

  it("distinguishes a measured zero from an unknown", () => {
    expect(formatPercent(0)).toBe("0");
    expect(formatPercent(null)).toBe(ABSENT);
  });
});

describe("formatMs", () => {
  it("stays in milliseconds however large the number gets", () => {
    // Never seconds: the log rows' DUR column, the health pills and this tile all read in ms, and
    // one surface switching units is how two numbers about the same request stop being comparable.
    expect(formatMs(8014)).toBe("8014");
  });

  it("keeps a decimal for a sub-ten-millisecond latency", () => {
    expect(formatMs(9.5)).toBe("9.5");
    expect(formatMs(3)).toBe("3");
  });
});

describe("poolShare and poolTone", () => {
  const pool = (active: number, idle: number, waiting = 0) => ({ active, idle, waiting });

  it("measures the fill against the pool's own size, since no ceiling is exposed", () => {
    expect(poolShare(pool(3, 7))).toBeCloseTo(0.3, 10);
    expect(poolShare(pool(10, 0))).toBe(1);
  });

  it("is calm while connections are in use and something is still free", () => {
    expect(poolTone(pool(3, 7))).toBe("ok");
  });

  it("warns once nothing is idle — full is not yet failing", () => {
    // A pool with every connection in use and nobody queued behind it is a pool doing its job.
    expect(poolTone(pool(10, 0))).toBe("warn");
  });

  it("goes red the moment anything is queued, which is the request that becomes a 500", () => {
    expect(poolTone(pool(10, 0, 1))).toBe("error");
  });

  it("names the waiters, because they are the part that hurts", () => {
    expect(formatPool(pool(3, 7))).toBe("3/10");
    expect(formatPool(pool(10, 0, 2))).toBe("10/10 · 2 waiting");
  });

  it("has no share to report for a pool of no connections", () => {
    expect(poolShare(pool(0, 0))).toBe(0);
  });
});

describe("loopTone", () => {
  it("is calm at the lag a healthy loop actually runs at", () => {
    expect(loopTone(11)).toBe("ok");
  });

  it("warns a quarter of the way to a request waiting on the loop", () => {
    expect(loopTone(30)).toBe("warn");
  });

  it("is red once a request is waiting on the loop rather than on its work", () => {
    expect(loopTone(140)).toBe("error");
  });
});

describe("hasSeries", () => {
  it("needs two known points before there is a line to draw", () => {
    expect(hasSeries([{ v: 1 }, { v: 2 }])).toBe(true);
    expect(hasSeries([{ v: 1 }, { v: null }])).toBe(false);
  });

  it("has nothing to draw for a range the collector was not watching", () => {
    expect(hasSeries([{ v: null }, { v: null }, { v: null }])).toBe(false);
    expect(hasSeries([])).toBe(false);
  });
});
