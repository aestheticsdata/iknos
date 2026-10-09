/**
 * The metrics view's copy (IKN-23), in one place — the same split every other view uses.
 *
 * English, like the rest of the interface. The provenance line is the one sentence here that is
 * load-bearing rather than descriptive: it is what stops a reader taking an interpolated p95 for a
 * measured one (design doc §5.3).
 */
export const METRICS_TEXT = {
  title: "Routes",
  tag: "metrics",
  sortedBy: "sorted by p95 ▼",
  rangeLabel: (range: string) => `last ${range}`,

  /* ── Table ────────────────────────────────────────────────────────────────────────────────── */
  colRoute: "route",
  colRate: "rate",
  colP50: "p50",
  colP95: "p95",
  colP99: "p99",
  colErr: "err",
  colShare: "share",
  /* A route that exists — prom-client has a series for it — and that nobody called in the range. */
  noSamples: "no samples in this range",
  noRoutes: "No route has reported a request histogram yet.",
  selectHint: (route: string) => `Show ${route} in detail`,
  shareLabel: (share: string) => `${share} of the service's requests`,

  /* ── Whole-view states ────────────────────────────────────────────────────────────────────── */
  pickService: "Pick a service in the rail — routes are a property of one service.",
  notScraped: "This service exposes no /metrics, so there is no route to measure.",
  /* Stem only; `<Pending>` draws the dots — see `SERVICE_TEXT.loading` (IKN-57). */
  loading: "reading",
  failed: "Could not read this service's routes.",
  detailFailed: "Could not read this route.",
  retry: "retry",

  /* ── Detail ───────────────────────────────────────────────────────────────────────────────── */
  percentiles: "latency percentiles",
  chartLabel: (route: string) => `${route} latency percentiles over the range`,
  noChart: "No interval of this range can be quoted.",
  threshold: "alert threshold",
  toLogs: "logs →",
  toLogsHint: "Open this route's log lines for the selected range",
  distribution: "latency distribution",
  distributionEmpty: "No observation in this range.",
  bucketHint: (label: string, count: string) => `${count} request${count === "1" ? "" : "s"} ${label}`,
  status: "status codes",
  statusEmpty: "No response in this range.",
  summary: "summary",
  throughput: "throughput",
  requests: "requests",
  errorRate: "error rate",
  rateUnit: "req/s",
  provenance: "scraped from /metrics every 15s · histogram buckets from prom-client",
  provenanceHint:
    "Percentiles are interpolated within these buckets, not measured — like Prometheus' histogram_quantile",
} as const;
