import type { CHART_SURFACE } from "../chartSurface";
import type { METRIC } from "../metricTokens";

/** One of the series the app draws. A metric keeps its colour on every chart (IKN-86). */
export type Metric = (typeof METRIC)[keyof typeof METRIC];

/** The ink classes one metric is drawn with. Each is a `text-*` class, read as `currentColor`. */
export type MetricInk = {
  /** Its bars, its curve. */
  bar: string;
  /** The 24h trend curve laid over its bars. */
  strong: string;
  /** Its bars while the trend is drawn over them. */
  tint: string;
  /** Its total, printed as text beside the chart. */
  text: string;
  /** The 4×9 swatch in a tooltip row. */
  swatch: string;
};

/** A point in the SVG's pixel space. */
export type Point = { x: number; y: number };

/** A bar's horizontal extent, in whole pixels so its edges are crisp. */
export type BarSpan = { x: number; width: number };

/** What a chart's y axis runs over. */
export type Domain = { min: number; max: number };

/** A line across a gauge at a value on its own axis, such as the disk chart's alert lines. */
export type GaugeMark = { value: number; label: string };

/** One bucket of a latency chart. `null` is an interval nobody could quote. */
export type PercentileBucket = { p50: number | null; p95: number | null; p99: number | null };

/** Where a day starts on a bucket axis, and how it is labelled under it. */
export type DayStart = { index: number; label: string };

/** One row of a chart tooltip: a series, its swatch and its value at the bucket. */
export type ChartTipRow = { label: string; value: string; swatch: string };

/** The ground a chart stands on. */
export type ChartSurface = (typeof CHART_SURFACE)[keyof typeof CHART_SURFACE];

/** What a chart's one-sentence summary for a screen reader is made from. */
export type SeriesSummary = {
  /** `Visitors`. */
  series: string;
  /** `last 7d`. */
  span: string;
  /** The headline figure, already written: `249`. */
  total: string | null;
  values: readonly (number | null)[];
  /** What the bucket at an index is called: `Sat 7 · 14:00 → 15:00`. */
  bucketName: (index: number) => string | null;
};
