import { describe, expect, it } from "vitest";
import { histogramQuantile, parseLe } from "./histogram-quantile";

/**
 * The p95, held to worked examples (IKN-13).
 *
 * Every number below was computed by hand from Prometheus' own `bucketQuantile` — the point of the
 * exercise being that this function has to agree with the tool it is standing in for. A p95 that is
 * merely plausible is the failure mode: `_sum / _count` produces one, and it is a mean.
 */
describe("histogramQuantile", () => {
  /** Cumulative counts, as the `_bucket` series stores them. */
  const canonical = [
    { le: 1, count: 10 },
    { le: 2, count: 20 },
    { le: 5, count: 30 },
    { le: Number.POSITIVE_INFINITY, count: 30 },
  ];

  it("interpolates linearly inside the bucket the rank falls in", () => {
    // 30 observations · rank = 0.95 × 30 = 28.5 · lands in (2, 5] which holds 10 of them
    //   → 2 + (5 − 2) × (28.5 − 20) / 10 = 4.55
    expect(histogramQuantile(0.95, canonical)).toBeCloseTo(4.55, 10);
  });

  it("does not depend on the order the buckets arrive in", () => {
    const shuffled = [canonical[2], canonical[0], canonical[3], canonical[1]];

    expect(histogramQuantile(0.95, shuffled)).toBeCloseTo(4.55, 10);
  });

  it("measures the lowest bucket from zero", () => {
    // Everything is under 100ms, so the rank lands in the first bucket, whose floor is 0 —
    // a duration is not negative and prom-client's first bound is a resolution, not a minimum.
    const fast = [
      { le: 0.1, count: 100 },
      { le: 1, count: 100 },
      { le: Number.POSITIVE_INFINITY, count: 100 },
    ];

    expect(histogramQuantile(0.95, fast)).toBeCloseTo(0.095, 10);
  });

  it("returns the highest finite bound when the quantile falls in +Inf", () => {
    // Half the observations are past the last bound, so the histogram cannot say where they are.
    // Prometheus answers with the largest number it can stand behind, and so does this.
    const overflowing = [
      { le: 1, count: 5 },
      { le: 2, count: 5 },
      { le: Number.POSITIVE_INFINITY, count: 10 },
    ];

    expect(histogramQuantile(0.95, overflowing)).toBe(2);
  });

  it("repairs a non-monotonic histogram rather than reading it out of order", () => {
    // `le=2` reports fewer observations than `le=1`, which is impossible and arrives anyway when
    // two series are scraped a moment apart. Carried forward: 4, 4, 10, 10.
    //   rank = 0.5 × 10 = 5 · lands in (2, 5] which holds 6 → 2 + 3 × (5 − 4) / 6 = 2.5
    const drifted = [
      { le: 1, count: 4 },
      { le: 2, count: 2 },
      { le: 5, count: 10 },
      { le: Number.POSITIVE_INFINITY, count: 10 },
    ];

    expect(histogramQuantile(0.5, drifted)).toBeCloseTo(2.5, 10);
  });

  it("adds together buckets that share a bound", () => {
    // What summing one route's histogram with another's produces before anything else happens.
    const summed = [
      { le: 1, count: 5 },
      { le: 1, count: 5 },
      { le: Number.POSITIVE_INFINITY, count: 10 },
    ];

    expect(histogramQuantile(0.95, summed)).toBeCloseTo(0.95, 10);
  });

  it("says nothing about a range in which nothing was observed", () => {
    const idle = [
      { le: 1, count: 0 },
      { le: Number.POSITIVE_INFINITY, count: 0 },
    ];

    // Not zero. A service that served nothing has no p95, and `0ms` there would read as the
    // fastest it has ever been.
    expect(histogramQuantile(0.95, idle)).toBeNull();
  });

  it("refuses a histogram with no open-ended bucket", () => {
    // The observations past the highest finite bound are exactly the ones a high quantile is
    // about, and a histogram that does not count them cannot be asked where its 95th is.
    const closed = [
      { le: 1, count: 5 },
      { le: 2, count: 10 },
    ];

    expect(histogramQuantile(0.95, closed)).toBeNull();
  });

  it("refuses a histogram with a single bucket", () => {
    expect(histogramQuantile(0.95, [{ le: Number.POSITIVE_INFINITY, count: 10 }])).toBeNull();
  });

  it("refuses a quantile outside [0, 1]", () => {
    expect(histogramQuantile(1.5, canonical)).toBeNull();
    expect(histogramQuantile(Number.NaN, canonical)).toBeNull();
  });

  it("drops a bucket whose bound is not a number", () => {
    const withGarbage = [...canonical, { le: Number.NaN, count: 999 }];

    expect(histogramQuantile(0.95, withGarbage)).toBeCloseTo(4.55, 10);
  });
});

describe("parseLe", () => {
  it("reads the open-ended bucket as infinity, both spellings", () => {
    expect(parseLe("+Inf")).toBe(Number.POSITIVE_INFINITY);
    expect(parseLe("Inf")).toBe(Number.POSITIVE_INFINITY);
  });

  it("reads a bound as a number, so that sorting is numeric and not lexicographic", () => {
    // The whole reason this exists: as strings, "10" sorts before "5" and the top of every
    // histogram is silently reversed.
    expect(parseLe("10")).toBe(10);
    expect(parseLe("0.05")).toBe(0.05);
  });

  it("has nothing to say about a missing or unparseable bound", () => {
    expect(parseLe(null)).toBeNull();
    expect(parseLe("")).toBeNull();
    expect(parseLe("soon")).toBeNull();
  });
});
