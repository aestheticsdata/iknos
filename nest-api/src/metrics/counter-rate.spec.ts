import { describe, expect, it } from "vitest";
import { type BucketSample, coverage, increments, NO_TAG, perSecond } from "./counter-rate";

/**
 * Counter arithmetic, held to worked examples (IKN-13).
 *
 * The three cases that matter are the three a naive subtraction gets wrong: a process restart, a
 * series that appears part-way through the window, and a scrape the collector missed. None of them
 * is exotic — the box restarts every deploy, routes are called for the first time all day, and a
 * missed scrape is what a busy event loop looks like from outside.
 */

const sample = (bucket: number, value: number, series = "a", tag: string | null = null): BucketSample => ({
  bucket,
  series,
  tag,
  value,
});

describe("increments", () => {
  it("differences consecutive readings, the priming interval included", () => {
    const line = increments([sample(-1, 100), sample(0, 110), sample(1, 130), sample(2, 130)], 3);

    // The first interval is 10 rather than empty precisely because of the reading at −1.
    expect(line.get(NO_TAG)).toEqual([10, 20, 0]);
  });

  it("discards the priming interval's own increment", () => {
    // Two readings before the range: the 50 between them belongs to a window nobody asked about.
    const line = increments([sample(-2, 0), sample(-1, 50), sample(0, 60)], 1);

    expect(line.get(NO_TAG)).toEqual([10]);
  });

  it("treats a drop as a reset and counts the new value whole", () => {
    // The process restarted: the counter went back to zero and climbed to 20. Everything it had
    // served before the restart is gone, and under-counting is the honest way to say so — the
    // alternative is −80, which as a rate is nonsense and as a chart points down through the axis.
    const line = increments([sample(-1, 100), sample(0, 20), sample(1, 25)], 2);

    expect(line.get(NO_TAG)).toEqual([20, 5]);
  });

  it("contributes nothing for a series' first reading", () => {
    // A route called for the first time inside the window. Its counter is a total since the process
    // started; counting it as an increment would pour hours of traffic into one bar.
    const line = increments([sample(1, 500), sample(2, 505)], 3);

    expect(line.get(NO_TAG)).toEqual([0, 0, 5]);
  });

  it("spans a missed scrape rather than zero-filling it", () => {
    // Nothing was lost when the collector missed interval 1: the counter kept counting, and the
    // next reading carries the whole gap. Interval 1 is 0 *here* and is turned into a hole by the
    // coverage mask, which is a separate fact with a separate source.
    const line = increments([sample(-1, 0), sample(0, 10), sample(2, 40)], 3);

    expect(line.get(NO_TAG)).toEqual([10, 0, 30]);
  });

  it("adds series that share a tag and keeps different tags apart", () => {
    const rows = [
      sample(-1, 0, "ok-dossiers", "200"),
      sample(0, 5, "ok-dossiers", "200"),
      sample(-1, 0, "ok-exports", "200"),
      sample(0, 7, "ok-exports", "200"),
      sample(-1, 0, "bad-exports", "500"),
      sample(0, 2, "bad-exports", "500"),
    ];

    const lines = increments(rows, 1);

    expect(lines.get("200")).toEqual([12]);
    expect(lines.get("500")).toEqual([2]);
  });

  it("differences each series on its own, so one series' reset is not hidden by another's growth", () => {
    // Summing first and differencing after would give (10 + 5) − (10 + 100) = −95 for one interval
    // and lose the restart entirely. Differencing first gives 5 + 90.
    const rows = [
      sample(-1, 10, "steady", "200"),
      sample(0, 15, "steady", "200"),
      sample(-1, 100, "restarted", "200"),
      sample(0, 90, "restarted", "200"),
    ];

    expect(increments(rows, 1).get("200")).toEqual([95]);
  });

  it("ignores a reading that is not a finite number", () => {
    const rows = [sample(-1, 0), sample(0, Number.NaN), sample(1, 4)];

    // The NaN is dropped, so interval 1 is differenced against the reading at −1.
    expect(increments(rows, 2).get(NO_TAG)).toEqual([0, 4]);
  });

  it("does not read floating-point drift as a restart", () => {
    // `_sum` series are doubles. A counter that reports 999999.9999999 after 1000000 has not gone
    // back to zero by a millionth of a request — but a bare comparison says it has, and injects the
    // entire counter as one interval's traffic.
    const drifted = [sample(-1, 1_000_000), sample(0, 999_999.999_999_9)];

    expect(increments(drifted, 1).get(NO_TAG)).toEqual([0]);
  });

  it("differences a restart it cannot see, and leaves the rest to the interval mask", () => {
    // The process came back and immediately served more than it had before: 1000 → 1200, no drop to
    // see, so this reports 200 for an interval that served 1200. That is not fixable per reading —
    // see `restartIntervals`, which refuses the interval outright — and every interval after it is
    // correct on this rule alone.
    expect(increments([sample(-1, 1_000), sample(0, 1_200)], 1).get(NO_TAG)).toEqual([200]);
  });

  it("does not depend on the order rows come back in", () => {
    const ordered = increments([sample(-1, 100), sample(0, 110), sample(1, 130)], 2);
    const jumbled = increments([sample(1, 130), sample(-1, 100), sample(0, 110)], 2);

    expect(jumbled).toEqual(ordered);
  });
});

describe("coverage", () => {
  it("marks the intervals a sample was seen in, and only those", () => {
    expect(coverage([0, 2], 3)).toEqual([true, false, true]);
  });

  it("ignores the priming interval and anything past the end", () => {
    expect(coverage([-1, 0, 7], 2)).toEqual([true, false]);
  });

  it("is entirely false for a range nothing was stored for", () => {
    expect(coverage([], 3)).toEqual([false, false, false]);
  });
});

describe("perSecond", () => {
  it("divides by the span it is given, which is the time actually measured", () => {
    // At `7d` an interval is six hours wide. Dividing by fifteen seconds would report a rate
    // fourteen hundred times too high — and dividing by six hours when only twenty minutes were
    // watched is the same mistake in the other direction, which is why the caller measures.
    expect(perSecond(60, 60_000)).toBe(1);
    expect(perSecond(3600, 3_600_000)).toBe(1);
  });

  it("is zero for an interval of no width rather than infinite", () => {
    expect(perSecond(10, 0)).toBe(0);
  });
});
