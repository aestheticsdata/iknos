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
  modeNormal: "NORMAL",
  keyLegend: "j/k move · ⏎ expand · / query · ⌘K palette",
  workSurfacePending: "The log panel arrives with IKN-12.",
} as const;
