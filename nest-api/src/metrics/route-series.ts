import { type BucketSample, increments, perSecond } from "./counter-rate";
import { histogramQuantile, type LeBucket, parseLe } from "./histogram-quantile";
import { readLabel } from "./metric-labels";
import {
  DURATION_BUCKET,
  type Intervals,
  intervalsOf,
  isServerError,
  type MetricRow,
  pointsOf,
  REQUESTS_TOTAL,
  SECONDS_TO_MS,
} from "./signal-series";

import type { LatencyBucket, RouteKey, RouteRow, RouteSummary, StatusSplit } from "@contracts/route-metrics";
import type { Signal } from "@contracts/service-signals";
import type { SourcePlan } from "./metric-window";

/**
 * Rows → one set of figures per route (IKN-23). The service tiles' arithmetic, split by route.
 *
 * Nothing here is new mathematics, and that is the point: the counters are differenced by
 * `increments`, the intervals are the ones `intervalsOf` lets the service tiles quote, and every
 * percentile is `histogramQuantile` over the summed increments of the range. A route's p95 that
 * disagreed with the service p95 about which minutes count would be two answers to one question.
 */

export const QUANTILES = { p50: 0.5, p95: 0.95, p99: 0.99 } as const;

/** One route's increments: response counts by status code, and latency counts by `le`. */
type RouteLines = {
  method: string;
  route: string;
  requests: Map<string, number[]>;
  durations: Map<string, number[]>;
};

/**
 * The key a route is grouped under — the pair, because prom-client labels the pair.
 *
 * JSON rather than a separator: label values are arbitrary strings, and any separator is a
 * character some route could contain.
 */
const keyOf = (method: string, route: string, tag: string): string => JSON.stringify([method, route, tag]);

/**
 * The rows of one metric, tagged by route *and* the metric's own grouping label.
 *
 * A series without a `route` label is left out: it is not a route, and inventing one for it would
 * put a row in the table nobody can open.
 */
function routeSamples(rows: MetricRow[], name: string, tag: string): BucketSample[] {
  const out: BucketSample[] = [];

  for (const row of rows) {
    if (row.name !== name) continue;
    const route = readLabel(row.labels, "route");
    if (route === null) continue;

    out.push({
      bucket: row.bucket,
      series: row.series,
      tag: keyOf(readLabel(row.labels, "method") ?? "", route, readLabel(row.labels, tag) ?? ""),
      value: row.value,
    });
  }

  return out;
}

/** Every route seen in the rows, with its per-interval increments. */
export function routeLines(rows: MetricRow[], buckets: number): Map<string, RouteLines> {
  const out = new Map<string, RouteLines>();

  const lineOf = (tag: string) => {
    const [method, route, inner] = JSON.parse(tag) as [string, string, string];
    const key = JSON.stringify([method, route]);
    let lines = out.get(key);
    if (!lines) {
      lines = { method, route, requests: new Map(), durations: new Map() };
      out.set(key, lines);
    }
    return { lines, inner };
  };

  for (const [tag, line] of increments(routeSamples(rows, REQUESTS_TOTAL, "status_code"), buckets)) {
    const { lines, inner } = lineOf(tag);
    lines.requests.set(inner, line);
  }
  for (const [tag, line] of increments(routeSamples(rows, DURATION_BUCKET, "le"), buckets)) {
    const { lines, inner } = lineOf(tag);
    lines.durations.set(inner, line);
  }

  return out;
}

/** One line summed over the intervals that can be quoted. */
const usableSum = (line: number[], usable: boolean[]): number =>
  line.reduce((sum, value, i) => (usable[i] ? sum + value : sum), 0);

/** The sum of every usable interval of every line the predicate keeps. */
function usableTotal(lines: Map<string, number[]>, usable: boolean[], keep: (tag: string) => boolean = () => true) {
  let total = 0;
  for (const [tag, line] of lines) {
    if (keep(tag)) total += usableSum(line, usable);
  }
  return total;
}

/**
 * One interval's histogram, or the whole range's when `index` is `null`.
 *
 * The range figure adds the increments of every usable interval back into one histogram and takes
 * the quantile once — a percentile of percentiles is not a percentile of anything (`p95Of`).
 */
function histogramOf(durations: Map<string, number[]>, usable: boolean[], index: number | null): LeBucket[] {
  const out: LeBucket[] = [];

  for (const [tag, line] of durations) {
    const le = parseLe(tag === "" ? null : tag);
    if (le === null) continue;

    out.push({ le, count: index === null ? usableSum(line, usable) : line[index] });
  }

  return out;
}

const quantileMs = (q: number, buckets: LeBucket[]): number | null => {
  const value = histogramQuantile(q, buckets);
  return value === null ? null : value * SECONDS_TO_MS;
};

/** A route's figures over the range — everything in its row but the share. */
function summaryOf(lines: RouteLines, intervals: Intervals): RouteSummary {
  const { elapsed, usable } = intervals;

  const requests = usableTotal(lines.requests, usable);
  const errors = usableTotal(lines.requests, usable, isServerError);
  const measured = elapsed.reduce((sum: number, ms, i) => (usable[i] ? sum + (ms as number) : sum), 0);
  const whole = histogramOf(lines.durations, usable, null);

  return {
    method: lines.method,
    route: lines.route,
    requests,
    // Over the time measured, never the width of the range — the throughput tile's rule.
    rate: measured === 0 ? null : perSecond(requests, measured),
    p50: quantileMs(QUANTILES.p50, whole),
    p95: quantileMs(QUANTILES.p95, whole),
    p99: quantileMs(QUANTILES.p99, whole),
    errorRate: requests > 0 ? (errors / requests) * 100 : null,
  };
}

/**
 * Worst p95 first, which is the question the view exists to answer.
 *
 * A route with no p95 goes last rather than first or nowhere: it is still a route of the service,
 * and the empty state on its row is the answer to "was it called". Ties fall to traffic, then to
 * the name, so the order does not shuffle between two polls of the same numbers.
 */
export function compareRoutes(a: RouteRow, b: RouteRow): number {
  if (a.p95 !== b.p95) {
    if (a.p95 === null) return 1;
    if (b.p95 === null) return -1;
    return b.p95 - a.p95;
  }
  if (a.requests !== b.requests) return b.requests - a.requests;
  return `${a.route} ${a.method}`.localeCompare(`${b.route} ${b.method}`);
}

/** The routes table: every route in the rows, with its share of the service's traffic. */
export function buildRouteRows(rows: MetricRow[], plan: SourcePlan): RouteRow[] {
  const intervals = intervalsOf(rows, plan.buckets);
  const summaries = [...routeLines(rows, plan.buckets).values()].map((lines) => summaryOf(lines, intervals));

  const total = summaries.reduce((sum, row) => sum + row.requests, 0);

  return summaries.map((row) => ({ ...row, share: total > 0 ? row.requests / total : null })).sort(compareRoutes);
}

/**
 * The latency histogram as intervals between consecutive scraped bounds.
 *
 * The cumulative counts are made monotonic first, exactly as the quantile does it, so two bucket
 * series scraped a fraction of a second apart cannot produce a negative interval.
 */
export function distributionOf(cumulative: LeBucket[]): LatencyBucket[] {
  const sorted = [...cumulative].sort((a, b) => a.le - b.le);

  let running = 0;
  let previousLe = 0;
  let previousCount = 0;
  const out: LatencyBucket[] = [];

  for (const bucket of sorted) {
    running = Math.max(running, bucket.count);
    out.push({
      fromMs: previousLe * SECONDS_TO_MS,
      toMs: bucket.le === Number.POSITIVE_INFINITY ? null : bucket.le * SECONDS_TO_MS,
      count: running - previousCount,
    });
    previousLe = bucket.le;
    previousCount = running;
  }

  return out;
}

/** Response counts by class. Anything that is not a three-digit code is `other`. */
export function statusSplitOf(requests: Map<string, number[]>, usable: boolean[]): StatusSplit {
  const split: StatusSplit = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0, other: 0 };

  for (const [tag, line] of requests) {
    const key = /^[2-5]\d\d$/.test(tag) ? (`${tag[0]}xx` as keyof StatusSplit) : "other";
    split[key] += usableSum(line, usable);
  }

  return split;
}

export type RouteDetailSet = {
  summary: RouteSummary;
  p50: Signal;
  p95: Signal;
  p99: Signal;
  distribution: LatencyBucket[];
  status: StatusSplit;
};

/** What the detail is built from: the rows, the grid they are laid on, and the route. */
export type RouteDetailInput = {
  rows: MetricRow[];
  from: Date;
  plan: SourcePlan;
  target: RouteKey;
};

/**
 * One route in detail, or `null` when the rows do not contain it.
 *
 * The rows are expected to have been narrowed to the route in SQL already; the lookup by key is
 * what makes that a performance choice rather than a correctness one.
 */
export function buildRouteDetail(input: RouteDetailInput): RouteDetailSet | null {
  const { rows, from, plan, target } = input;
  const intervals = intervalsOf(rows, plan.buckets);
  const lines = routeLines(rows, plan.buckets).get(JSON.stringify([target.method, target.route]));
  if (!lines) return null;

  const summary = summaryOf(lines, intervals);

  const series = (q: number, value: number | null): Signal => {
    const values = Array.from({ length: plan.buckets }, (_, i) =>
      intervals.usable[i] ? quantileMs(q, histogramOf(lines.durations, intervals.usable, i)) : null,
    );
    return { value, points: pointsOf(values, from, plan.bucketMs) };
  };

  return {
    summary,
    p50: series(QUANTILES.p50, summary.p50),
    p95: series(QUANTILES.p95, summary.p95),
    p99: series(QUANTILES.p99, summary.p99),
    distribution: distributionOf(histogramOf(lines.durations, intervals.usable, null)),
    status: statusSplitOf(lines.requests, intervals.usable),
  };
}
