import { ABSENT, formatMs } from "@lib/serviceFormat";

import type { Tone } from "@components/ui/surface";
import type {
  LatencyBucket,
  Percentile,
  RouteKey,
  RouteRow,
  RouteSummary,
  StatusClass,
  StatusPart,
  StatusSplit,
} from "@lib/metricsTypes";

/**
 * The metrics view's arithmetic of presentation (IKN-23) — pure, and tested beside it.
 *
 * Nothing here computes a latency. The percentiles arrive interpolated from the server and this
 * module only decides how they read: which ones are coloured, which row is the costly one, what a
 * bucket is called, and which rows can be opened at all.
 */

/** The percentiles, named once. */
export const PERCENTILE: Record<Percentile, Percentile> = { p50: "p50", p95: "p95", p99: "p99" };

/**
 * PFA's word for a request no route matched (IKN-2) — the scanners, mostly.
 *
 * A real share of the traffic, so it stays in the table; but it is not a route, and there is no
 * set of log lines "filtered on `unknown`" to open.
 */
export const UNMATCHED_ROUTE = "unknown";

/** A latency with its unit — `412ms`, or `—` where the buckets could not answer. */
export const formatLatency = (value: number | null): string => (value === null ? ABSENT : `${formatMs(value)}ms`);

/** A p95 past the alert engine's threshold is coloured — the same line the alert fires on. */
export const p95Tone = (p95: number | null, thresholdMs: number): Tone =>
  p95 !== null && p95 > thresholdMs ? "error" : "neutral";

/** A route nobody called in the range: an explicit empty row, and nothing to open. */
export const hasSamples = (row: Pick<RouteRow, "requests">): boolean => row.requests > 0;

/** Whether a click can take the reader to this route's log lines. */
export const linksToLogs = (row: RouteSummary): boolean => hasSamples(row) && row.route !== UNMATCHED_ROUTE;

/**
 * The costly row — the one the table paints with the error ground.
 *
 * The top of a list sorted by p95, **but only past the threshold**. The mockup paints its first
 * row unconditionally because its first row is on fire; on a calm afternoon the slowest route of
 * a healthy service is a 40ms read, and a red band across it would be an alarm about nothing.
 */
export const costlyRoute = (rows: RouteRow[], thresholdMs: number): RouteKey | null => {
  const top = rows[0];
  return top !== undefined && p95Tone(top.p95, thresholdMs) === "error" ? top : null;
};

/** `0.4%`, `38%`, `—` — the share of the service's traffic. */
export const formatShare = (share: number | null): string => {
  if (share === null || !Number.isFinite(share)) return ABSENT;
  const percent = share * 100;
  if (percent === 0) return "0%";
  if (percent < 1) return `${percent.toFixed(1)}%`;
  return `${Math.round(percent)}%`;
};

/**
 * A bucket's name, in its scraped bounds.
 *
 * Milliseconds throughout, never seconds, for `formatMs`'s reason — every latency in the product is
 * in one unit. `≤ 25ms` for the first, `> 1000ms` for `+Inf`, and the two bounds otherwise.
 */
export const bucketLabel = (bucket: LatencyBucket): string => {
  if (bucket.toMs === null) return `> ${formatMs(bucket.fromMs)}ms`;
  if (bucket.fromMs === 0) return `≤ ${formatMs(bucket.toMs)}ms`;
  return `${formatMs(bucket.fromMs)}–${formatMs(bucket.toMs)}ms`;
};

/**
 * A bucket's colour, by where it sits against the threshold.
 *
 * Read off the threshold rather than off fixed numbers so that it follows prom-client's bounds and
 * the alert engine's line wherever either moves: the open bucket above the line is red, the one
 * reaching it amber, and the fast end green.
 */
export const bucketTone = (bucket: LatencyBucket, thresholdMs: number): Tone => {
  if (bucket.toMs === null || bucket.fromMs >= thresholdMs) return "error";
  if (bucket.toMs > thresholdMs / 4) return "warn";
  if (bucket.toMs > thresholdMs / 10) return "info";
  return "ok";
};

/** Each bucket's share of the observations, 0–1, or `null` when there are none to divide by. */
export const bucketShares = (buckets: LatencyBucket[]): (number | null)[] => {
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  return buckets.map((bucket) => (total > 0 ? bucket.count / total : null));
};

/** The classes, in the order the bar stacks them. */
export const STATUS_CLASSES: readonly StatusClass[] = ["2xx", "3xx", "4xx", "5xx", "other"];

export const STATUS_TONE: Record<StatusClass, Tone> = {
  "2xx": "ok",
  "3xx": "info",
  "4xx": "warn",
  "5xx": "error",
  other: "neutral",
};

/** The classes the legend leaves out while they are empty. */
const SHOWN_WHEN_PRESENT: readonly StatusClass[] = ["3xx", "other"];

/**
 * The stacked bar's segments.
 *
 * `3xx` and `other` only when they hold something: the mockup's legend is three classes long, and
 * a fourth and fifth swatch reading `0%` under every route would be noise. `2xx`, `4xx` and `5xx`
 * always — an absent `5xx` is the fact a reader is looking for.
 */
export const statusParts = (split: StatusSplit): StatusPart[] => {
  const total = STATUS_CLASSES.reduce((sum, key) => sum + split[key], 0);
  if (total === 0) return [];

  return STATUS_CLASSES.filter((key) => split[key] > 0 || !SHOWN_WHEN_PRESENT.includes(key)).map((key) => ({
    key,
    count: split[key],
    share: split[key] / total,
  }));
};
