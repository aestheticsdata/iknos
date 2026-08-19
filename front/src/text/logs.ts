/**
 * The Logs view's copy, in one place — the same split the chassis and the auth screens use.
 *
 * English, like the rest of the interface and unlike the tickets.
 */
export const LOGS_TEXT = {
  /* Token query bar */
  filtersLabel: "Filters",
  addFilter: "add filter",
  filterOn: "Disable this filter, keeping its value",
  filterOff: "Re-enable this filter",
  removeFilter: "Remove this filter",
  live: "LIVE",
  paused: "PAUSED",
  liveHint: "Follow new lines as they arrive",
  pausedHint: "Scrolled away from the top — new lines are held",
  resume: "back to top",
  newLines: (n: number) => `${n} new ${n === 1 ? "line" : "lines"}`,
  fullscreen: "fullscreen",
  filterNames: {
    service: "service",
    level: "level",
    route: "route",
    status: "status",
    q: "text",
  },

  /* Window */
  pinnedWindow: "pinned to a bucket",
  unpinWindow: "back to the range",
  refresh: "refresh",

  /* Histogram */
  histogramLabel: "Volume over the selected range",
  anomaly: (count: number) => `+${count} err`,
  anomalyHint: "The interval whose error count is furthest above the rest of the window",
  bucketHint: "Narrow the range to this interval",
  noVolume: "No lines in this range.",

  /* Table */
  columns: {
    // Labelled, because the panel is UTC throughout and the chassis clock beside it is not.
    time: "time · utc",
    level: "lvl",
    service: "service",
    route: "route",
    status: "st",
    message: "message",
    trace: "trace",
    duration: "dur",
  },
  empty: "No lines match these filters in this range.",
  loadMore: "load more",
  loading: "loading…",
  endOfResults: "That is every line in the range.",
  expandRow: "Show the raw event",
  collapseRow: "Hide the raw event",
  rawEvent: "event",
  context: "context",
  stack: "stack",
  openTrace: "trace",
  copyRow: "copy NDJSON",
  copied: "copied",

  /* Trace */
  traceTitle: "trace",
  traceTotal: (ms: number) => `${ms} ms total`,
  traceTruncated: "This trace logged more lines than are shown — the total covers only these.",
  traceEmpty: "No lines carry this trace id in the current range.",
  copyTraceId: "copy id",
  openInLogs: "open in logs",
  close: "close",

  /* Live tail */
  gap: (n: number) => `${n} ${n === 1 ? "line" : "lines"} dropped — the tail could not keep up`,
  disconnected: "connection lost — reconnecting…",
  reconnected: "reconnected",

  /* Failures */
  searchFailed: "Could not load logs.",
  histogramFailed: "Could not load the volume chart.",
  traceFailed: "Could not load this trace.",
  retry: "retry",
} as const;
