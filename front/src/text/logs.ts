/**
 * The Logs view's copy, in one place — the same split the chassis and the auth screens use.
 *
 * English, like the rest of the interface and unlike the tickets.
 */
/**
 * The time label, shared by the column heading and the detail pane so the hydration invariant the
 * spec guards — a bare `time` until the zone is known — cannot be true in one of them and not the
 * other. Everything else in the two vocabularies differs on purpose; this one may not.
 */
const timeLabel = (zone: string | null) => (zone === null ? "time" : `time · ${zone.toLowerCase()}`);

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
  // Source-neutral: a bucket click and a manual jump both land here, and the badge cannot tell
  // which one put it there.
  pinnedWindow: "pinned window",
  unpinWindow: "back to the range",
  refresh: "refresh",
  jumpToTime: "jump to time",
  go: "go",

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
    time: timeLabel,
    level: "lvl",
    service: "service",
    route: "route",
    status: "st",
    message: "message",
    trace: "trace",
    duration: "dur",
  },

  /*
   * The detail pane's labels — the columns above, spelled out.
   *
   * One vocabulary until IKN-60, and the split is the point rather than a duplication to tidy away
   * later. `lvl`, `st` and `dur` are what a heading has to be when eight columns share the width of
   * a log line; a modal has no such constraint, and carrying the abbreviations into it was
   * inheriting a compromise instead of making one. The pane can afford the words, so it says them.
   *
   * The last four never had a column above them to borrow from. `client` and not `ip`: it is the
   * address of whoever called, and the pane already says `host` for the machine that answered — two
   * words that would be one letter apart as `ip` and `host`.
   */
  detailFields: {
    time: timeLabel,
    level: "level",
    service: "service",
    route: "route",
    status: "status",
    trace: "trace",
    duration: "duration",
    client: "client",
    user: "user",
    host: "host",
    agent: "agent",
  },
  empty: "No lines match these filters in this range.",
  /* Stem only; `<Pending>` draws the dots — see `SERVICE_TEXT.loading` (IKN-57). */
  loading: "loading",
  /* The scroll edges' overlay (IKN-59) — which way the page being fetched is walking. Stems too. */
  loadingNewer: "loading newer lines",
  loadingOlder: "loading older lines",
  endOfResults: "That is every line in the range.",
  openRow: "Show the raw event",
  /*
   * The raw event is the wire payload and its `ts` is UTC whatever the column beside it reads, so
   * the heading says so — but only when the two actually differ. A panel already in UTC would gain
   * nothing from `event · utc` except a second place to read the same word.
   */
  rawEvent: (zone: string | null) => (zone === null || zone.toLowerCase() === "utc" ? "event" : "event · utc"),
  context: "context",
  stack: "stack",
  openTrace: "trace",
  /* The footer's `⌘I` slot, filled by IKN-14 — the shortcut itself cannot fire inside a modal. */
  openIssue: "issue",
  copyRow: "copy NDJSON",
  copied: "copied",
  /* The tooltip on the client address's copy control, and the name a screen reader gets for it —
     the glyph alone says "copy" and not "copy what", which is the half that matters when the pane
     has four values in it a reader might have meant. */
  copy: "copy",
  copyIp: "copy the client address",

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
  /* Stem only, like the rest — though nothing renders this yet: `useLiveTail` computes `connected`
     and no caller reads it, so a dropped stream is invisible today. Wiring it is its own ticket with
     its own question in it (is a reconnect an attempt or a fault), and stripping the ellipsis here
     now is what keeps the rule from having an exception waiting inside it. */
  disconnected: "connection lost — reconnecting",
  reconnected: "reconnected",

  /* Failures */
  searchFailed: "Could not load logs.",
  histogramFailed: "Could not load the volume chart.",
  traceFailed: "Could not load this trace.",
  /* Said inside the pane and not over the stream: the line is still on screen and still readable,
     and only the half that had to be fetched is missing. */
  detailFailed: "Could not load the rest of this line.",
  retry: "retry",
} as const;
