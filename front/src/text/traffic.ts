/**
 * The traffic view's copy (IKN-83), in one place — the same split every other view uses.
 *
 * English, like the rest of the interface. "Visitors" here always means visitors *per day*: one
 * address and browser on one calendar day, never followed across days. The hints say so wherever
 * the number is shown, because "unique visitors" is the claim this view deliberately does not make.
 */
export const TRAFFIC_TEXT = {
  title: "traffic",
  allSites: "all sites",
  rangeLabel: (range: string) => `last ${range}`,
  rawLines: "raw lines in logs",

  /* ── Whole-view states ────────────────────────────────────────────────────────────────────── */
  notASite: "This service has no nginx access log, so there is no traffic to show.",
  sitesHeading: "sites with traffic",
  noSites: "No service has an nginx access log yet.",
  noRequests: "no requests in this range",
  /* Stem only; `<Pending>` draws the dots — see `SERVICE_TEXT.loading` (IKN-57). */
  loading: "reading",
  failed: "Could not read this site's traffic.",
  overviewFailed: "Could not read the sites' traffic.",
  retry: "retry",
  partial: "This range holds more requests than one read covers; every number is a floor.",
  retention: (days: number) => `Logs are kept ${days} days: older requests are gone, not zero.`,

  /* ── Tiles ────────────────────────────────────────────────────────────────────────────────── */
  visitors: "visitors",
  visitorsUnit: "per day, summed",
  visitorsHint: "One address and browser on one calendar day. The same person on two days counts twice.",
  dailyAverage: (n: string) => `${n} a day on average`,
  pageViews: "page views",
  pageViewsUnit: "pages read",
  pageViewsHint: "Full page loads by people. Images, scripts, bots and in-app navigation are not counted.",
  perVisit: "pages per visit",
  perVisitUnit: "per visitor-day",
  humanShare: "people",
  humanShareUnit: "of requests",
  humanShareHint: "Requests from browsers, against crawlers, tools and scanners.",
  shared: "shared links",
  sharedUnit: "preview fetches",
  sharedHint: "Each one is a chat app or social network fetching a preview because someone posted a link.",
  bandwidth: "bandwidth",
  bandwidthUnit: "served",

  /* ── Chart ────────────────────────────────────────────────────────────────────────────────── */
  overTime: "over time",
  seriesVisitors: "visitors arriving",
  seriesPageViews: "page views",
  seriesAutomated: "bots and scanners",
  chartLabel: (series: string) => `${series} per interval over the range`,
  tip: (label: string, value: string, series: string) => `${label} · ${value} ${series}`,
  tipGone: (label: string) => `${label} · older than the retention`,

  /* ── Tables ───────────────────────────────────────────────────────────────────────────────── */
  topPages: "top pages",
  morePages: (n: number) => `and ${n} more`,
  entryPages: "entry pages",
  sources: "sources",
  campaigns: "campaigns",
  browsers: "browsers",
  systems: "systems",
  devices: "devices",
  hourOfDay: "hour of day",
  hourOfDayLabel: "Page views by hour of day, in your time zone",
  hourTip: (hour: number, views: string) => `${String(hour).padStart(2, "0")}:00 · ${views} page views`,
  bots: "bots",
  scanners: (requests: string, addresses: string) => `scanners: ${requests} requests from ${addresses} addresses`,
  previewTag: "preview",
  status: "status",
  brokenLinks: "broken links",
  colPage: "page",
  colViews: "views",
  colVisitors: "visitors",
  colSource: "source",
  colLandings: "landed on",
  colCampaign: "campaign",
  colMedium: "medium",
  colName: "name",
  colRequests: "requests",
  colLastSeen: "last seen",
  colClass: "class",
  colPeople: "people",
  colAutomated: "automated",
  colHits: "hits",
  colFrom: "from",
  openInLogs: (route: string) => `Open ${route} in logs`,
  emptyTable: "nothing in this range",

  /* ── Overview ─────────────────────────────────────────────────────────────────────────────── */
  topSource: "top source",
  sparkLabel: (site: string) => `${site} visitors over the range`,
  openSite: (site: string) => `Show ${site}'s traffic`,
};
