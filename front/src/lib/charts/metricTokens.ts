import type { Tone } from "@components/ui/surface";
import type { Metric, MetricInk } from "./interfaces/chartTypes";

/**
 * Which colour each metric is drawn in, and the one place that says so (IKN-86).
 *
 * Visitors are green, page views blue, bots amber and errors red, on every chart in the app. A
 * chart asks for a metric and gets its inks. It never names a colour itself, so the same series
 * can never be green on one page and blue on the next.
 *
 * The classes are written out in full. Tailwind only emits a class it can find as a literal, and an
 * SVG with no fill rule paints **black**.
 */
export const METRIC = {
  visitors: "visitors",
  views: "views",
  bots: "bots",
  errors: "errors",
  /** A count with no metric of its own: log lines, occurrences, ingested events. */
  neutral: "neutral",
  /** A continuous gauge: req/s, CPU, memory, load. */
  gauge: "gauge",
  /** The p50 → p99 strip of a latency chart. */
  range: "range",
  /** A p95: its tick on a latency chart, its curve on a tile. */
  p95: "p95",
  /** A series on the dark rail. */
  spark: "spark",
  /** The selected service's series on the dark rail. */
  sparkActive: "sparkActive",
} as const;

export const METRIC_INK: Record<Metric, MetricInk> = {
  [METRIC.visitors]: {
    bar: "text-chart-visitors",
    strong: "text-chart-visitors-strong",
    tint: "text-chart-visitors-tint",
    text: "text-chart-visitors-ink",
    swatch: "bg-chart-visitors",
  },
  [METRIC.views]: {
    bar: "text-chart-views",
    strong: "text-chart-views-strong",
    tint: "text-chart-views-tint",
    text: "text-chart-views-ink",
    swatch: "bg-chart-views",
  },
  [METRIC.bots]: {
    bar: "text-chart-bots",
    strong: "text-chart-bots-strong",
    tint: "text-chart-bots",
    text: "text-chart-bots-ink",
    swatch: "bg-chart-bots",
  },
  [METRIC.errors]: {
    bar: "text-chart-error",
    strong: "text-chart-error",
    tint: "text-chart-error",
    text: "text-chart-error-ink",
    swatch: "bg-chart-error",
  },
  [METRIC.neutral]: {
    bar: "text-chart-neutral",
    strong: "text-chart-neutral",
    tint: "text-chart-neutral",
    text: "text-chart-ref",
    swatch: "bg-chart-neutral",
  },
  [METRIC.gauge]: {
    bar: "text-chart-gauge",
    strong: "text-chart-gauge",
    tint: "text-chart-gauge",
    text: "text-chart-visitors-ink",
    swatch: "bg-chart-gauge",
  },
  [METRIC.range]: {
    bar: "text-chart-range",
    strong: "text-chart-range",
    tint: "text-chart-range",
    text: "text-chart-ref",
    swatch: "bg-chart-range",
  },
  [METRIC.p95]: {
    bar: "text-chart-p95",
    strong: "text-chart-p95",
    tint: "text-chart-p95",
    text: "text-chart-bots-ink",
    swatch: "bg-chart-p95",
  },
  [METRIC.spark]: {
    bar: "text-chart-spark",
    strong: "text-chart-spark",
    tint: "text-chart-spark",
    text: "text-chassis-text-muted",
    swatch: "bg-chart-spark",
  },
  [METRIC.sparkActive]: {
    bar: "text-chart-spark-active",
    strong: "text-chart-spark-active",
    tint: "text-chart-spark-active",
    text: "text-chassis-text",
    swatch: "bg-chart-spark-active",
  },
};

/**
 * The series that may carry a 24h trend.
 *
 * Not bots, and not errors: both arrive in bursts, and a moving average of bursts draws a gentle
 * hill where there were three spikes and a lot of nothing.
 */
export const TRENDABLE: ReadonlySet<Metric> = new Set([METRIC.visitors, METRIC.views]);

/**
 * The metric a state reads as on a meter: a healthy gauge is green, a warning amber, a fault red.
 * For the meters that were coloured by tone before the chart language had metrics (IKN-86).
 */
export const TONE_METRIC: Record<Tone, Metric> = {
  ok: METRIC.gauge,
  warn: METRIC.bots,
  error: METRIC.errors,
  info: METRIC.views,
  neutral: METRIC.neutral,
};
