/**
 * `GET /api/sli` (IKN-88) — one service's request indicators over one window, read by Zeus to
 * decide whether a deploy degraded the service.
 *
 * Read from the nginx access lines only. nginx sees every request a visitor made, including the 502
 * it wrote itself because the app behind it was down — the one request the app can never log.
 *
 * **Counts, not ratios.** Zeus applies its own minimum volume before trusting a rate, and the 30-day
 * SLOs planned on top of this will need to add windows together, which a ratio cannot do.
 *
 * Zeus is a separate repository with no shared package; it restates this shape. This file is the
 * authoritative copy.
 */
export type SliWindow = {
  service: string;
  from: string;
  to: string;
  /** Echoed back so a caller can see which half of a shared vhost it measured. */
  pathPrefix: string | null;
  excludePathPrefix: string | null;
  /** Access lines in the window. A line nginx wrote but the parser could not read is not counted. */
  requests: number;
  /** Lines whose status, as the visitor got it, was 500 or above. */
  errors5xx: number;
  /**
   * Lines that carried `$request_time`. Lower than `requests` when the window straddles the
   * `log_format` switch, or when the vhost still writes `combined`; `p95Ms` is computed over these.
   */
  timed: number;
  /** Nearest-rank 95th percentile of the request time, or `null` when no line was timed. */
  p95Ms: number | null;
  /**
   * How far the collector has read and stored, or `null` if it has not completed a pass since boot.
   *
   * **The field that keeps silence from passing for health.** A window that ends after this moment
   * is not fully counted yet: zero requests there may mean a stalled collector, not a quiet site.
   * Zeus calls a window it cannot trust "verification impossible" rather than "no traffic".
   */
  ingestedThrough: string | null;
};
