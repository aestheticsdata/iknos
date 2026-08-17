import { describe, expect, it } from "vitest";
import { chooseBucketMs, MAX_BUCKETS } from "./histogram.service";

const span = (ms: number) => chooseBucketMs(0, ms);

describe("chooseBucketMs", () => {
  it("gives a minute per bucket over an hour", () => {
    expect(span(60 * 60_000)).toBe(60_000);
  });

  it("gives an hour per bucket over a day", () => {
    expect(span(24 * 60 * 60_000)).toBe(3_600_000);
  });

  it("never exceeds the ceiling, whatever the range", () => {
    // The one that matters. Without it, a week asked for in one-second intervals is six hundred
    // thousand rows out of MySQL and six hundred thousand points into a chart.
    for (const ms of [1_000, 900_000, 3_600_000, 86_400_000, 604_800_000, 10 * 365 * 86_400_000]) {
      expect(Math.ceil(ms / chooseBucketMs(0, ms))).toBeLessThanOrEqual(MAX_BUCKETS);
    }
  });

  it("never returns zero or a negative size for a degenerate range", () => {
    expect(chooseBucketMs(0, 0)).toBeGreaterThan(0);
    expect(chooseBucketMs(500, 0)).toBeGreaterThan(0);
  });

  it("always returns a whole number of seconds", () => {
    // The query buckets on TIMESTAMPDIFF(SECOND, …); a fractional second here would silently
    // truncate in SQL and put rows in the wrong bar.
    for (const ms of [1_000, 90_123, 604_800_000, 10 * 365 * 86_400_000]) {
      expect(chooseBucketMs(0, ms) % 1000).toBe(0);
    }
  });
});
