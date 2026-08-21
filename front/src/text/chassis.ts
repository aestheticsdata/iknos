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
  paused: "paused",
  pausedHint: "Collection is disabled for this service",
  noServices: "No services — the API is unreachable or the registry is empty.",
  logOut: "log out",
  loggingOut: "signing out…",
  /* IKN-38. The button says which clock is in force; the hint says what the clock governs, which
     the three or four letters on their own cannot. */
  zoneHint: "The clock every timestamp in the panel is read on",
  zoneSwitch: (to: string) => `switch to ${to}`,
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
  storageLoading: "reading…",
  storageFailed: "Could not read storage usage.",
  storageRetry: "retry",
  storageForever: "∞",
  storageOldest: (date: string) => `oldest ${date}`,
  storageNoPartition: "no partition yet",
  storageDisk: (used: string, total: string) => `disk ${used}/${total}`,
  storagePurge: (at: string) => `nightly purge ${at}`,
  storageReadAt: (at: string) => `read ${at}`,
  storageFiles: (n: number) => `${n} file${n === 1 ? "" : "s"} tailed`,
  modeNormal: "NORMAL",
  keyLegend: "j/k move · ⏎ expand · / query · ⌘K palette",
  workSurfacePending: "The log panel arrives with IKN-12.",
} as const;
