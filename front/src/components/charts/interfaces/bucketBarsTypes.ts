import type { DayStart, Metric } from "@lib/charts/interfaces/chartTypes";

/** A line across a count chart that splits its bars: red above it, neutral below (IKN-86). */
export type Threshold = { value: number };

/** What a row of bars is drawn from. Shared by `BucketBars` and the rows of `BucketPanel`. */
export type BucketSeries = {
  values: readonly (number | null)[];
  metric: Metric;
  /** The bucket in progress, hatched. Usually the last one, or `null` when every bucket is whole. */
  partialIndex?: number | null;
  /** The first bucket that has not happened yet. From there on, only a tick on the baseline. */
  futureFrom?: number | null;
  /**
   * The lowest the top of the scale may sit. The scale is 0 → max(series, this, threshold), so a
   * 0.4% blip on an error-rate chart floored at 1% does not fill the box.
   */
  minTop?: number;
  threshold?: Threshold | null;
  /** The 24h moving average to lay over the bars, which then step back to their tint. */
  trend?: readonly (number | null)[] | null;
  /** Where each day starts, for the dashed separators. */
  days?: readonly DayStart[];
};
