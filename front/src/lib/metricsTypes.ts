/**
 * What the metrics view's two routes return (IKN-23), restated — the authoritative copy is
 * `nest-api/src/contracts/route-metrics.ts`, like every other contract in this front end.
 *
 * Every latency is milliseconds interpolated from the histogram buckets **on the server**, and
 * every `null` means "the buckets cannot answer" — never zero.
 */

import type { Meta } from "@lib/logTypes";
import type { MetricSource, Signal } from "@lib/serviceTypes";
import type { RangeKey } from "@lib/timeRange";

/** Mirrors `contracts/route-metrics.ts`. A route is the pair prom-client labels it with. */
export type RouteKey = {
  method: string;
  route: string;
};

/** Mirrors `contracts/route-metrics.ts`. */
export type RouteRow = RouteKey & {
  requests: number;
  rate: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  /** Percent, 0–100 — 5xx over all responses. */
  errorRate: number | null;
  /** 0–1 of the service's requests. */
  share: number | null;
};

/** Mirrors `contracts/route-metrics.ts`. */
export type RouteSummary = Omit<RouteRow, "share">;

/** Mirrors `contracts/route-metrics.ts`. */
export type StatusSplit = {
  "2xx": number;
  "3xx": number;
  "4xx": number;
  "5xx": number;
  other: number;
};

/** One class of response — a key of the split. */
export type StatusClass = keyof StatusSplit;

/** One segment of the stacked status bar: a class, its count, and its share of the route's responses. */
export type StatusPart = {
  key: StatusClass;
  count: number;
  share: number;
};

/** Mirrors `contracts/route-metrics.ts`. `toMs: null` is `+Inf`. */
export type LatencyBucket = {
  fromMs: number;
  toMs: number | null;
  count: number;
};

/** Mirrors `contracts/route-metrics.ts`. */
export type RouteList = {
  service: string;
  scraped: boolean;
  from: string;
  to: string;
  source: MetricSource;
  p95ThresholdMs: number;
  routes: RouteRow[];
  meta: Meta;
};

/** The three percentiles the detail charts — each a field of `RouteDetail` and of `RouteRow`. */
export type Percentile = "p50" | "p95" | "p99";

/** Mirrors `contracts/route-metrics.ts`. */
export type RouteDetail = {
  service: string;
  from: string;
  to: string;
  bucketMs: number;
  source: MetricSource;
  p95ThresholdMs: number;
  summary: RouteSummary;
  p50: Signal;
  p95: Signal;
  p99: Signal;
  distribution: LatencyBucket[];
  status: StatusSplit;
  meta: Meta;
};

/** What `useRouteDetail` reads: the selection, on the range. A `null` anywhere reads nothing. */
export type RouteDetailTarget = {
  service: string | null;
  range: RangeKey;
  route: RouteKey | null;
};

/** Where a link into the metrics view lands: one service, on the range in force. */
export type MetricsHref = {
  service: string;
  range: RangeKey;
};
