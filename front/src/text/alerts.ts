/**
 * The alerts view's copy, in one place — the same split every other view uses.
 *
 * English, like the rest of the interface and unlike the tickets.
 */
export const ALERTS_TEXT = {
  /* The rail panel — the mockup's own heading and note. */
  panelTitle: "Alerts",
  panelNote: "evaluated by the collector",
  more: (n: number) => `${n} more · open Alerts →`,
  /* Stem only; `<Pending>` draws the dots — see `SERVICE_TEXT.loading` (IKN-57). */
  loading: "reading",
  /*
   * Three absences, never collapsed into one — the rule `ISSUES_TEXT` states and `Signals.tsx`
   * argues. "Nothing is wrong" and "we could not tell you whether anything is wrong" are the same
   * empty box unless the words are different, and on an alerts panel that difference is the
   * product.
   */
  none: "Nothing firing for this service.",
  failed: "Could not read alerts.",
  nothingYet: "The engine has not evaluated anything yet.",
  retry: "retry",

  /* The full view. */
  title: "Alerts",
  tag: "rules",
  segments: { open: "firing", acked: "acknowledged", resolved: "resolved", all: "all" } as const,
  segmentLabel: "State",
  severityLabel: "Severity",
  allSeverities: "all",
  emptyTable: "Nothing here.",
  loadMore: "load more",

  /* Per-card. `state` is the badge; the mockup sets it in caps. */
  states: { pending: "PENDING", firing: "FIRING", resolved: "RESOLVED" } as const,
  since: (duration: string) => `for ${duration}`,
  /* `pfa · now 3.1%` — the service, then the reading, in the mockup's own shape. */
  reading: (service: string, value: string) => `${service} · now ${value}`,

  /* The modal. */
  tileState: "state",
  tileService: "service",
  tileValue: "current",
  tileThreshold: "threshold",
  historyTitle: "state, last 6h",
  historyEmpty: "No transitions in this window.",
  ruleLabel: "rule",
  /* The truth of the product, and IKN-15 asks for it in as many words. */
  hint: "Nothing is pushed anywhere — you come and look.",
  cadence: (seconds: number) => `evaluated every ${seconds}s`,
  openLogs: "logs for this period →",

  /* Actions. */
  ack: "acknowledge",
  silence: "silence 1h",
  resolve: "resolve",
  acked: "Acknowledged.",
  silenced: "Silenced for an hour.",
  resolved: "Resolved.",
  actionFailed: "That did not go through.",

  /* The rail badge and the status bar read the same number from the same route (IKN-15 §4). */
  counterLabel: (n: number) => `${n} alert${n === 1 ? "" : "s"}`,
} as const;
