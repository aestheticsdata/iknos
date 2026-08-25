/**
 * Chassis copy, in one place — the same split the auth screens use.
 *
 * English, like the rest of the interface and unlike the tickets: the tracker is where the
 * thinking happens, the product is what one person reads at 3am.
 */
export const CHASSIS_TEXT = {
  host: "ks-b",
  services: "services",
  allServices: "all",
  /* The collapsed rail's monograms. Service names are abbreviated mechanically; these two are copy,
     because `AL` is not a word and a truncated `lo` would read as a rendering fault. */
  allServicesShort: "ALL",
  logOutShort: "OUT",
  breadcrumbLabel: "Current scope",
  rangeLabel: "Time range",
  railLabel: "Services and views",
  views: "views",
  viewLogs: "logs",
  viewIssues: "issues",
  paused: "paused",
  pausedHint: "Collection is disabled for this service",
  healthHint: (status: string, latency: string) => `Last health probe: ${status}${latency}`,
  healthWord: { ok: "healthy", error: "failing", stale: "stale" } as Record<string, string>,
  sparklineLabel: (name: string) => `${name} log volume, last hour`,
  noServices: "No services — the API is unreachable or the registry is empty.",
  logOut: "log out",
  /* Stem only; `<Pending>` draws the dots — see `SERVICE_TEXT.loading` (IKN-57). */
  loggingOut: "signing out",
  /* IKN-38, then IKN-48. The two halves name the two clocks and the lit one says which is in
     force, so nothing is left for a label to spell out; the hint still says what that clock
     governs, which three or four letters on their own cannot. The group carries a name of its own
     because a screen reader announces the pair before it reads either half. */
  zoneLabel: "Time zone",
  zoneHint: "The clock every timestamp in the panel is read on",
  /* IKN-24 — Iknos describing itself. `collectorState` is what the dot means in words: the colour
     alone is unreadable to roughly one man in twelve, and `unknown` in particular has no colour of
     its own to read. */
  collector: "collector",
  lag: "lag",
  collectorState: {
    unknown: "starting",
    ok: "collecting",
    warn: "behind",
    down: "stopped",
  },
  collectorHint: (state: string, age: string) => `Collector ${state} · last checked ${age} ago`,
  collectorUnknownHint: "No reading yet — the collector has not completed a pass since it started",
  ingest: "ingest",
  ingestWindow: "60m",
  ingestEvents: (count: string) => `${count} ev`,
  ingestNothingYet: "no reading yet",
  ingestOpen: "Storage and retention",
  ingestDropped: (count: string) => `${count} dropped`,
  ingestDegraded: (count: string) => `${count} unreadable`,
  storageTitle: "Storage & retention",
  storageTag: "collector",
  /* Stem only; `<Pending>` draws the dots — see `SERVICE_TEXT.loading` (IKN-57). */
  storageLoading: "reading",
  storageFailed: "Could not read storage usage.",
  storageRetry: "retry",
  storageForever: "∞",
  storageOldest: (date: string) => `oldest ${date}`,
  storageNoPartition: "no partition yet",
  storageDisk: (used: string, total: string) => `disk ${used}/${total}`,
  storagePurge: (at: string) => `nightly purge ${at}`,
  storageReadAt: (at: string) => `read ${at}`,
  storageFiles: (n: number) => `${n} file${n === 1 ? "" : "s"} tailed`,
  /* IKN-22 — the palette. The action word on the right of a row is what enter will do, and the
     four are genuinely different verbs: a result here is an action, not a link. */
  paletteTag: "palette",
  paletteTitle: "Go to",
  /* This ellipsis stays, and it is not an exception to the rule above: it means "and so on", not
     "in flight". A `placeholder` attribute could not carry the mark in any case — there is no
     element there to hang a pseudo-element on. */
  palettePlaceholder: "service, issue, route, trace id, view…",
  paletteHint: "↑↓ move · ⏎ open · esc close",
  palettePrompt: "Type to search services and issues, and routes and traces in the current window.",
  /* Stem only; `<Pending>` draws the dots — see `SERVICE_TEXT.loading` (IKN-57). */
  paletteSearching: "searching",
  paletteEmpty: "Nothing matches in this window.",
  paletteFailed: "Search is unavailable.",
  paletteScope: "scope",
  paletteFilter: "filter",
  paletteOpen: "open",
  paletteGo: "go",
  paletteIssue: "issue",
  /* IKN-22 §3 — the status bar's cells. */
  modeNormal: "NORMAL",
  modeModal: "MODAL",
  tailOn: "tail on",
  tailOff: "tail off",
  events: (count: string, range: string) => `${count} ev / ${range}`,
  queryTime: (ms: number) => `q ${ms}ms`,
  /* The permanent legend. Every entry here is a shortcut that works — which is why `⌘I` was absent
     until IKN-14 gave it something to open. A legend advertising a dead key is worse than a short
     legend. */
  keyLegend: "j/k move · ⏎ open · ⌥⏎ trace · ⌘I issue · / query · ⌘K palette",
  workSurfacePending: "The log panel arrives with IKN-12.",
} as const;
