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
    /*
     * Labelled with the zone in force, because the column shows a time of day and nothing else —
     * the reader has no other way to tell a UTC panel from a local one, and guessing wrong is how
     * an incident gets described two hours off.
     *
     * Bare `time` before the zone is known: this header is one of the few things in the panel that
     * *does* render on the server, where the answer is unknowable, and a label that guesses `utc`
     * for one frame would be wrong for most readers on every single page load.
     */
    time: (zone: string | null) => (zone === null ? "time" : `time · ${zone.toLowerCase()}`),
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
  /*
   * The raw event is the wire payload and its `ts` is UTC whatever the column beside it reads, so
   * the heading says so — but only when the two actually differ. A panel already in UTC would gain
   * nothing from `event · utc` except a second place to read the same word.
   */
  rawEvent: (zone: string | null) => (zone === null || zone.toLowerCase() === "utc" ? "event" : "event · utc"),
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
