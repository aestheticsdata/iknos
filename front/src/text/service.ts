/**
 * The service view's copy, in one place — the same split the chassis and the log panel use.
 *
 * English, like the rest of the interface and unlike the tickets. The register throughout is one
 * honest fact and, at most, one consequence: nothing here reassures, nothing exclaims, and nothing
 * offers a button, because §4's rule is that a block with no answer is inert rather than inviting.
 */
export const SERVICE_TEXT = {
  /**
   * The emitter line under the service name.
   *
   * A **constant**, and worth being clear that it is one: Iknos cannot see which logging library an
   * app uses. What it names is the ingestion contract every monitored service is expected to meet —
   * ECS-shaped NDJSON on stdout — which is a fact about Iknos rather than a measurement of this row.
   */
  emitter: "ECS · pino + @elastic/ecs-pino-format",

  /* ── Header chips ─────────────────────────────────────────────────────────────────────────── */
  chipPm2: "pm2 id",
  chipNode: "node",
  chipRelease: "release",
  chipUptime: "up",
  chipRestarts: "restarts",
  chipsLabel: "Process identity",
  /* The one chip that is a symptom rather than a card of identity. PM2 counts restarts for the life
     of the process entry, so the title says what the number is a total of. */
  restartsHint: (count: number) => `${count} restart${count === 1 ? "" : "s"} since pm2 first started this process`,
  releaseHint: "No deploy has written a release marker yet",
  processAbsent: "PM2 has reported nothing about this process in the last day",
  /* PM2's own word, so a process that is not running does not show a climbing uptime instead. */
  stoppedHint: (status: string) => `PM2 reports this process as ${status} — it is not running`,

  /* ── Health pills ─────────────────────────────────────────────────────────────────────────── */
  endpoint: "/health",
  /* Nothing answered at all — a transport failure, not a status to render. */
  noAnswer: "no answer",
  probeHint: (status: string, when: string) => `Probe ${status} · ${when} · probed every 30s`,
  probeStatus: { ok: "answered", error: "failed", stale: "went quiet" } as Record<string, string>,
  checkHint: (name: string, status: string, latency: string) => `${name} reported ${status}${latency}`,
  probedNever: "A health endpoint is registered, but no probe has answered yet.",
  probedNot: "No health endpoint is registered for this service.",

  /* ── Signal tiles ─────────────────────────────────────────────────────────────────────────── */
  throughput: "THROUGHPUT",
  throughputUnit: "req/s",
  errorRate: "ERROR RATE",
  errorRateUnit: "%",
  /* The tile counts 5xx only, and says so — otherwise a reader comparing it against the log panel's
     error rows below would find two different numbers and no explanation. */
  errorRateHint: "5xx as a share of all responses",
  latency: "p95 LATENCY",
  latencyUnit: "ms",
  latencyReference: (value: string) => `p95 over the whole range · ${value}ms`,
  runtime: "NODE RUNTIME",
  loopLag: "event loop",
  dbPool: "db pool",
  poolHint: (waiting: number) =>
    waiting > 0
      ? `${waiting} request${waiting === 1 ? "" : "s"} queued for a connection`
      : "Connections in use, out of the pool's size",
  loopHint: "The 99th percentile of event-loop lag",

  /* Chart descriptions, for the accessibility tree. A chart is `role="img"` and needs a sentence. */
  throughputChart: (name: string) => `${name} requests per second over the selected range`,
  errorChart: (name: string) => `${name} server-error rate over the selected range`,
  latencyChart: (name: string) => `${name} p95 latency over the selected range`,

  /* ── Empty and error states ───────────────────────────────────────────────────────────────── */
  /* No service picked — the rail's `all` row, or a URL with no `?service=`. */
  noService: "This view answers about one service at a time — pick one in the rail.",
  /* The registry row has no metricsUrl. A permanent fact about the world, not a range to widen. */
  notScraped: "No /metrics endpoint is registered for this service — nothing is scraped from it.",
  /* Scraped, but this range holds nothing that can be quoted. */
  noSamples: "No samples in this range.",
  /* One reading, and a line needs two. Kept short: the chart box is a fixed 26px and every one of
     these has to fit on one line of 10px text inside a tile a quarter of the work surface wide. */
  noSeries: "One reading — too few for a line.",
  runtimeSilent: "No reading in the last few minutes.",
  loading: "reading…",
  failed: "Could not read this service.",
  retry: "retry",

  /**
   * The provenance line under the tiles — §5.3's doctrine, applied here.
   *
   * It is not decoration. A p95 interpolated from ten bucket bounds looks exactly like a measured
   * one, and this sentence is what stops a reader treating `412ms` as a request that actually took
   * 412 milliseconds. The cadences are the collector's own (IKN-8).
   */
  provenance: "scraped from /metrics every 15s · p95 interpolated from prom-client buckets",
  /* Appended when the range reaches back past the raw window and the hourly aggregates answer for it. */
  provenanceRollup: "older intervals read from hourly rollups",

  /* ── Links ────────────────────────────────────────────────────────────────────────────────── */
  /* Two, because two blocks have somewhere real to lead today. The throughput and latency tiles
     point at the routes table (IKN-23) and carry no affordance until it exists — a link that lands
     on the screen the reader is already looking at is a worse promise than no link. */
  toErrorLogs: "Open this service's error logs for the selected range",
  toProbeLogs: "Open this service's error logs around the failed probe",
} as const;
