import { describe, expect, it } from "vitest";
import { gridStart, planSource, ROLLUP_MS, windowsFor } from "./metric-window";

/**
 * Which table answers a range, and where the two are cut (IKN-13).
 *
 * `now` and the retention window are parameters precisely so these cases can exist: the cliff is
 * otherwise three days behind whenever the suite happens to run, and the interesting question is
 * always where `from` falls relative to it.
 */

const NOW = new Date("2026-08-23T12:00:00.000Z");
const RAW_DAYS = 3;
/** The oldest instant raw samples can be relied on, given the two above. */
const CLIFF = new Date("2026-08-20T12:00:00.000Z");

const ago = (ms: number) => new Date(NOW.getTime() - ms);

const HOUR = 3_600_000;
const DAY = 86_400_000;

describe("planSource", () => {
  it("answers a recent range from the raw table, on the log histogram's own grid", () => {
    const plan = planSource(ago(HOUR), NOW, NOW, RAW_DAYS);

    // One hour at sixty buckets is a minute each — `chooseBucketMs`, shared with IKN-19 so that
    // two charts on the same screen are not laid out on two different ideas of a readable axis.
    expect(plan).toEqual({ bucketMs: 60_000, buckets: 60, boundary: 0, source: "raw" });
  });

  it("answers a range entirely older than the raw window from the rollups", () => {
    const plan = planSource(ago(30 * DAY), ago(10 * DAY), NOW, RAW_DAYS);

    expect(plan.source).toBe("rollup");
    expect(plan.boundary).toBe(plan.buckets);
    expect(plan.bucketMs).toBe(DAY);
  });

  it("cuts a range that straddles the cliff, and cuts it on a bucket boundary", () => {
    const from = ago(7 * DAY);
    const plan = planSource(from, NOW, NOW, RAW_DAYS);

    expect(plan.source).toBe("mixed");
    expect(plan.bucketMs).toBe(6 * HOUR);
    expect(plan.buckets).toBe(28);
    // Four days of rollups at six hours each, then three days of raw samples.
    expect(plan.boundary).toBe(16);
    expect(gridStart(from, plan.bucketMs, plan.boundary)).toEqual(CLIFF);
  });

  it("gives the bucket the cliff falls inside to the rollups", () => {
    // Rounded up, because a bucket straddling the cliff has raw rows for only part of itself, and
    // half an interval reported as a whole one is a dip in the chart at exactly the point a reader
    // would otherwise be told to distrust.
    const from = new Date(CLIFF.getTime() - 30 * 60_000);
    const plan = planSource(from, new Date(CLIFF.getTime() + 30 * 60_000), NOW, RAW_DAYS);

    expect(plan.bucketMs).toBe(ROLLUP_MS);
    expect(plan.buckets).toBe(1);
    expect(plan.boundary).toBe(1);
    expect(plan.source).toBe("rollup");
  });

  it("never asks an hourly aggregate for a finer interval than it has", () => {
    // Twelve hours would naturally bucket at fifteen minutes. Reaching past the cliff forces the
    // hour, because four empty bars beside every full one is not a chart.
    const plan = planSource(ago(3 * DAY + 12 * HOUR), ago(3 * DAY), NOW, RAW_DAYS);

    expect(plan.bucketMs).toBe(ROLLUP_MS);
    expect(plan.source).toBe("rollup");
  });

  it("leaves the grid alone when nothing comes from the rollups", () => {
    // The same twelve hours, entirely inside the raw window: fifteen-minute buckets, as chosen.
    const plan = planSource(ago(12 * HOUR), NOW, NOW, RAW_DAYS);

    expect(plan.bucketMs).toBe(900_000);
    expect(plan.source).toBe("raw");
  });
});

describe("windowsFor", () => {
  it("primes the raw window with one interval before the range", () => {
    const from = ago(HOUR);
    const plan = planSource(from, NOW, NOW, RAW_DAYS);
    const { raw, rollup } = windowsFor(from, NOW, plan);

    expect(rollup).toBeNull();
    // Without that extra minute the first bar of every chart would be empty for no visible reason:
    // a counter's first reading is a total, not an increment.
    expect(raw).toEqual({ from: new Date(from.getTime() - 60_000), to: NOW });
  });

  it("primes the rollup window instead when the rollups answer the start of the range", () => {
    const from = ago(30 * DAY);
    const to = ago(10 * DAY);
    const plan = planSource(from, to, NOW, RAW_DAYS);
    const { raw, rollup } = windowsFor(from, to, plan);

    expect(raw).toBeNull();
    expect(rollup).toEqual({ from: new Date(from.getTime() - plan.bucketMs), to });
  });

  it("hands the two sources adjacent windows — no overlap at the seam, and no gap", () => {
    const from = ago(7 * DAY);
    const plan = planSource(from, NOW, NOW, RAW_DAYS);
    const { raw, rollup } = windowsFor(from, NOW, plan);

    expect(rollup).not.toBeNull();
    expect(raw).not.toBeNull();
    // Adjacent, to the millisecond. Overlapping them by a bucket to prime the raw side separately
    // would put two readings of one series in one interval, and the counter walk would difference
    // them against each other — a spurious increment on every chart wide enough to have a seam.
    expect(rollup?.to).toEqual(raw?.from);
    expect(raw?.from).toEqual(CLIFF);
    expect(raw?.to).toEqual(NOW);
    expect(rollup?.from).toEqual(new Date(from.getTime() - plan.bucketMs));
  });
});

describe("gridStart", () => {
  it("indexes intervals from the start of the range, with −1 as the priming interval", () => {
    const from = new Date("2026-08-23T12:00:00.000Z");

    expect(gridStart(from, HOUR, 0)).toEqual(from);
    expect(gridStart(from, HOUR, 2)).toEqual(new Date("2026-08-23T14:00:00.000Z"));
    expect(gridStart(from, HOUR, -1)).toEqual(new Date("2026-08-23T11:00:00.000Z"));
  });
});
