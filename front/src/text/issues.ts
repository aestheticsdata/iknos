/**
 * The issues view's copy, in one place — the same split the other views use.
 *
 * English, like the rest of the interface and unlike the tickets.
 */
export const ISSUES_TEXT = {
  /* The rail panel — the mockup's own heading and note. */
  panelTitle: "Issues · fingerprints",
  panelNote: "unresolved",
  more: (n: number) => `${n} more unresolved · open Issues →`,
  /* Stem only; `<Pending>` draws the dots — see `SERVICE_TEXT.loading` (IKN-57). */
  loading: "reading",
  /*
   * Three absences, never collapsed into one.
   *
   * `Signals.tsx` names collapsing them as the one thing a monitoring tool must not do, and an
   * issues panel is where it would be most tempting: "nothing broke" and "we could not tell you
   * whether anything broke" are the same empty box unless the words are different.
   */
  none: "Nothing unresolved for this service.",
  failed: "Could not read issues.",
  nothingYet: "No errors have been grouped yet.",
  retry: "retry",

  /* The full view. */
  title: "Issues",
  tag: "grouped errors",
  segments: { unresolved: "unresolved", resolved: "resolved", ignored: "ignored" } as const,
  sorts: { last: "last seen", volume: "volume", first: "first seen" } as const,
  sortLabel: "Sort",
  segmentLabel: "Status",
  emptyTable: "Nothing here.",
  loadMore: "load more",
  /* The list is served in one page whose size this view raises, and the server's ceiling is real.
     Said out loud rather than left as a button that stops working: a silent cap is a list claiming
     to be complete. */
  capped: (n: number) => `Showing the first ${n}. Narrow the segment or the service to see the rest.`,

  /* The table's columns — the mockup's own headings. */
  colFingerprint: "fingerprint",
  colError: "error",
  colService: "service",
  colEvents: "events·48h",
  colCount: "count",
  colFirstSeen: "first seen",
  colLastSeen: "last seen",
  colRelease: "release",

  /* The modal. */
  tileFingerprint: "fingerprint",
  tileOccurrences: "occurrences",
  tileLastSeen: "last seen",
  tileFirstSeen: "first seen",
  tileService: "service",
  occurrences: "occurrences · 48h",
  stack: "latest stack",
  noStack: "This error arrived without a stack.",
  openLogs: "open the logs of this request",
  noTrace: "This occurrence carried no trace id.",
  regression: "regression",

  /* The three actions, and what they say when they land. `close` is here rather than borrowed from
     `LOGS_TEXT`: a view's copy is its own, and sharing a string across two of them is how one of
     them ends up renamed for the other's reasons. */
  close: "close",
  resolve: "resolve",
  ignore: "ignore",
  reopen: "reopen",
  resolved: "Issue resolved.",
  ignored: "Issue ignored.",
  reopened: "Issue reopened.",
  actionFailed: "Could not update the issue.",
  /* `⌘I` on a line that was never grouped. One sentence for three absences — not an error, not
     grouped yet, out of range — because all three mean the same thing to somebody pressing a key. */
  noIssueForLine: "No issue for this line.",
  openIssue: "issue",

  /* Accessibility. */
  sparkLabel: (type: string) => `${type} occurrences, last 48 hours`,
  recency: {
    error: "seen in the last 15 minutes",
    warn: "seen in the last hour",
    info: "seen in the last day",
    ok: "not seen today",
  } as Record<string, string>,
} as const;
