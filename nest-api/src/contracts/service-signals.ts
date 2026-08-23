import type { Meta } from "./meta";

/**
 * The three time series behind the service view's first three tiles (IKN-13): throughput, error
 * rate and p95 latency, over whatever range the caller asked for.
 *
 * **The caller asks for a range, never for a source.** Which table answers — `metric_sample` while
 * the raw window still reaches back that far, `metric_rollup` beyond it, or both stitched at the
 * boundary — is decided here and reported in `source` for honesty, not for the client to act on.
 * A front end that had to know which table held its data would have to know the retention policy
 * too, and would be wrong about it the first time the environment variable moved.
 *
 * **The p95 is interpolated from the raw histogram buckets, server-side**, exactly as
 * `histogram_quantile` does it — never an average of `_sum / _count`, and never arithmetic in the
 * browser. That is the whole reason `metric_sample` stores the `_bucket` parts untouched.
 */

/**
 * One point of one series.
 *
 * `v` is `null` for an interval nobody scraped, and `0` for an interval that was scraped and had
 * nothing to report. Those are different facts and the chart draws them differently: a gap in the
 * line where the collector was down, a line on the floor where the service was idle. Collapsing
 * the first into the second is how a monitoring tool reports an outage as a quiet afternoon.
 */
export type SignalPoint = {
  /** Start of the interval, ISO-8601 UTC. */
  t: string;
  v: number | null;
};

export type Signal = {
  /**
   * The tile's headline — the value over the **whole range**, not the last bucket and never the
   * mean of the points.
   *
   * For the p95 that distinction is not pedantry: averaging sixty per-bucket p95s is not a
   * percentile of anything, and it reads low exactly when one bucket has gone bad. The headline is
   * recomputed from the increments of the entire window as though it were a single bucket.
   */
  value: number | null;
  /** One entry per interval, covering the whole requested range with no gaps in the *x* axis. */
  points: SignalPoint[];
};

/**
 * Which table answered.
 *
 * `mixed` is the interesting one: the range reaches back past the raw window, so the older
 * intervals come from the hourly rollups and the newer ones from raw samples, joined on a bucket
 * boundary so that no interval is served twice and none is missed. `none` means the service is not
 * scraped at all — there was nothing to choose between.
 */
export type MetricSource = "raw" | "rollup" | "mixed" | "none";

export type ServiceSignals = {
  service: string;
  /** The window actually served, echoed back — the grid the points are laid on. */
  from: string;
  to: string;
  /**
   * Chosen by the server from the span, exactly as the log histogram's is (IKN-19), and widened to
   * a whole hour whenever any part of the answer comes from the rollups: an hourly aggregate
   * cannot be cut into five-minute intervals, and pretending otherwise would draw four empty bars
   * for every full one.
   */
  bucketMs: number;
  source: MetricSource;
  /** Whether the registry row carries a `metricsUrl`. See `ServiceRuntime.scraped`. */
  scraped: boolean;
  /** Requests per second. */
  throughput: Signal;
  /**
   * Percent, 0–100 — **5xx over all responses**.
   *
   * 4xx is deliberately not counted. A wrong password is a 401 and a missing export is a 404;
   * both are the application working. Folding them in would leave this tile amber every time
   * somebody mistyped a password, which is the fastest way to teach a reader to ignore it. The
   * failure this tile exists to catch is the route that fell over, and that route answers 500.
   *
   * `null` for an interval with no requests at all: a rate with an empty denominator is undefined,
   * not zero.
   */
  errorRate: Signal;
  /** Milliseconds. */
  p95: Signal;
  meta: Meta;
};
