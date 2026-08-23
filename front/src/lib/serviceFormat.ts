import { formatBytes } from "@lib/format";

import type { Tone } from "@components/ui/surface";
import type { PoolGauge } from "@lib/serviceTypes";

/**
 * The arithmetic the service view does at render time (IKN-13).
 *
 * Out here rather than in the components for the usual reason: these are the decisions that would
 * be wrong in silence. A pool bar that turns red one connection late, an uptime that rounds `23h`
 * to `1d`, a `0` drawn where the answer is "nobody knows" — none of them fails, and all of them
 * are read as facts.
 *
 * The em dash is the house spelling for an absent value, and it is used everywhere below rather
 * than a blank: a chip that renders empty reads as a layout bug, and a chip that renders `—` reads
 * as a question nobody has answered yet.
 */

export const ABSENT = "—";

/**
 * `up 6d 04h`, the mockup's own spelling.
 *
 * Computed from `startedAt` at render time rather than served as a duration, so that a payload
 * cached for thirty seconds does not claim the process started thirty seconds later than it did.
 * Two units at most: past a day the minutes are noise, and under an hour the days are zero.
 */
export const formatUptime = (startedAt: string | null, now: number = Date.now()): string => {
  if (startedAt === null) return ABSENT;

  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return ABSENT;

  // A process that reports a start time in the future is a clock that disagrees, not an uptime to
  // render as a negative. Clamped rather than dashed: it did start, and `0m` says so.
  const seconds = Math.max(0, Math.floor((now - started) / 1000));

  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${String(hours).padStart(2, "0")}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m`;
};

/**
 * A rate, at the precision the number carries.
 *
 * One decimal below ten, none above: `4.2 req/s` is a figure somebody can act on, and `41.23` is
 * three digits of jitter. Under a tenth it drops to two decimals rather than rounding to `0.0`,
 * because most of the services on this box genuinely do serve a request every few minutes and a
 * tile reading `0.0 req/s` over a service that is answering is the one thing it must not say.
 */
export const formatRate = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) return ABSENT;
  if (value === 0) return "0";
  if (value < 0.1) return value.toFixed(2);
  if (value < 10) return value.toFixed(1);
  return String(Math.round(value));
};

/**
 * A percentage — `1.8`, `12`, and `0` kept exact.
 *
 * Two decimals below a tenth, for the same reason `formatRate` has them: one failure in two
 * thousand requests is 0.05 %, and rounding it to `0.0` would print a red zero — a number that
 * contradicts the colour it is painted in and reads as a rendering fault rather than as a rare
 * error.
 */
export const formatPercent = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) return ABSENT;
  if (value === 0) return "0";
  if (value < 0.1) return value.toFixed(2);
  if (value < 10) return value.toFixed(1);
  return String(Math.round(value));
};

/**
 * A latency, in whole milliseconds past ten and one decimal below.
 *
 * Never seconds. Every latency in this product is milliseconds — the log rows' `DUR` column, the
 * health pills, this tile — and one surface switching units at a threshold is how two numbers about
 * the same request stop being comparable at a glance.
 */
export const formatMs = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) return ABSENT;
  if (value < 10) return Number(value.toFixed(1)).toString();
  return String(Math.round(value));
};

/** `318` out of `318 MB` — the heap's headline, with its unit rendered separately beside it. */
export const formatHeap = (bytes: number | null): { value: string; unit: string } => {
  if (bytes === null || !Number.isFinite(bytes)) return { value: ABSENT, unit: "heap" };

  const [value, unit] = formatBytes(bytes).split(" ");
  return { value, unit: `${unit} heap` };
};

/**
 * How full the pool is, as a fraction, and what to call it.
 *
 * The pool has no configured ceiling in the exposition — `active + idle` **is** its size — so
 * saturation is not "ninety percent of a maximum". It is that nothing is idle, and it only matters
 * once somebody is queued behind that: a pool with every connection in use and no waiters is a pool
 * doing exactly its job.
 *
 * That is the distinction the mockup's whole scenario turns on. An export queue holding all ten
 * connections is fine right up to the moment the eleventh request arrives, and it is the eleventh
 * request that turns the route into a 500.
 */
export const poolShare = (pool: PoolGauge): number => {
  const size = pool.active + pool.idle;
  return size > 0 ? pool.active / size : 0;
};

export const poolTone = (pool: PoolGauge): Tone => {
  if (pool.waiting > 0) return "error";
  if (pool.idle === 0) return "warn";
  return "ok";
};

/** `3/10`, and `3/10 · 2 waiting` once anything is queued. */
export const formatPool = (pool: PoolGauge): string => {
  const label = `${pool.active}/${pool.active + pool.idle}`;
  return pool.waiting > 0 ? `${label} · ${pool.waiting} waiting` : label;
};

/**
 * The event loop's own bar.
 *
 * The scale is fixed rather than relative to the series, because the question is not "is this lag
 * unusual for this service" but "is this service able to answer". A hundred milliseconds is the
 * point at which a request is waiting on the loop rather than on its work, so that is the full bar
 * — and anything past it pins, which is the reading a bar at its stop is meant to give.
 */
export const LOOP_LAG_FULL_MS = 100;

export const loopShare = (ms: number): number => Math.min(1, Math.max(0, ms / LOOP_LAG_FULL_MS));

export const loopTone = (ms: number): Tone => {
  if (ms >= LOOP_LAG_FULL_MS) return "error";
  if (ms >= LOOP_LAG_FULL_MS / 4) return "warn";
  return "ok";
};

/**
 * Whether a series has anything to draw.
 *
 * Two points, both of them known. A single point is not a line, and a series of nothing but nulls
 * is a range the collector was not watching — in either case the chart draws nothing at all and the
 * tile says why in words, which is the "absent, not faked" rule at the component level.
 */
export const hasSeries = (points: { v: number | null }[]): boolean =>
  points.filter((point) => point.v !== null).length >= 2;
