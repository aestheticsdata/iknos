import type { Meta } from "./meta";
import type { MetricSource, Signal } from "./service-signals";

/**
 * What the metrics view reads (IKN-23): every route of one service over the range, and one route
 * in detail.
 *
 * The identity of a route is **the pair** `method` + `route`, because that is how prom-client
 * labels it: `GET /api/spendings/:id` and `DELETE /api/spendings/:id` are two handlers with two
 * latency profiles, and summing them would put a cheap read and an expensive write behind one p95.
 *
 * `route` is the label as scraped — Express's matched pattern, never a raw URL. PFA files every
 * unmatched request under the literal `unknown`, which is passed through as it is: it is a real
 * share of the traffic, usually the scanners, and hiding it would make the shares not add up.
 *
 * Every latency is in **milliseconds**, interpolated from the histogram buckets on the server
 * (`histogram-quantile.ts`) and `null` wherever the buckets cannot answer — a route with no request
 * in the range has no p95, and the view says so rather than drawing `0ms`.
 */

/** One row of the routes table. Every figure is over the intervals that could be quoted. */
export type RouteRow = {
  method: string;
  route: string;
  /** Requests counted over the range. `0` is a route that exists and was not called. */
  requests: number;
  /** Requests per second, over the time actually measured — the throughput tile's rule. */
  rate: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  /** Percent, 0–100 — 5xx over all responses. `null` with no request to divide by. */
  errorRate: number | null;
  /** 0–1 — this route's requests over the service's. `null` when the service served none. */
  share: number | null;
};

/** What names a route: the pair prom-client labels it with. */
export type RouteKey = Pick<RouteRow, "method" | "route">;

/**
 * A route's figures without its share.
 *
 * The detail reads only its own route's series — narrowing in SQL is what keeps it cheap — so the
 * service's total is not in hand and a share would have to be invented. The table already shows it.
 */
export type RouteSummary = Omit<RouteRow, "share">;

/** Response counts by class, over the range. A status that is not three digits counts as `other`. */
export type StatusSplit = {
  "2xx": number;
  "3xx": number;
  "4xx": number;
  "5xx": number;
  other: number;
};

/**
 * One interval of the latency distribution — the observations between two **scraped** bounds.
 *
 * The bounds are prom-client's, exactly as configured: the view does not re-bin them into round
 * numbers, because there is no way to split a bucket's count across a boundary that was never
 * measured. Reconfigure prom-client and this list follows.
 */
export type LatencyBucket = {
  /** Lower bound in ms — `0` for the first bucket. */
  fromMs: number;
  /** Upper bound in ms, inclusive. `null` is `+Inf`: everything above the last finite bound. */
  toMs: number | null;
  count: number;
};

export type RouteList = {
  service: string;
  /** Whether the registry row carries a `metricsUrl`. False is permanent; an empty list is not. */
  scraped: boolean;
  from: string;
  to: string;
  source: MetricSource;
  /**
   * The p95 above which a route is coloured — the alert engine's own `LATENCY_P95_MS`, served
   * rather than restated so the table and the alert cannot disagree about what "slow" is.
   */
  p95ThresholdMs: number;
  /** Sorted by p95, worst first, with routes that have no p95 last. */
  routes: RouteRow[];
  meta: Meta;
};

export type RouteDetail = {
  service: string;
  from: string;
  to: string;
  bucketMs: number;
  source: MetricSource;
  p95ThresholdMs: number;
  /**
   * The collector's scrape cadence (IKN-63) — what the provenance line under the summary quotes.
   * Served rather than written into the copy, because it is an env knob and the copy would lie the
   * day it moved.
   */
  scrapeIntervalMs: number;
  /** The route's own figures over the whole range — the summary panel. */
  summary: RouteSummary;
  /** Per-interval percentiles. Each `value` is the whole range, recomputed, never a mean. */
  p50: Signal;
  p95: Signal;
  p99: Signal;
  distribution: LatencyBucket[];
  status: StatusSplit;
  meta: Meta;
};
