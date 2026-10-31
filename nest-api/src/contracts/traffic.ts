import type { Meta } from "./meta";

/**
 * The traffic view's two routes (IKN-83) — visitors read from the nginx access logs.
 *
 * **No client address appears anywhere in these shapes**, full or truncated, and that absence is
 * the privacy design rather than an omission (spec §3): visitors are counted per day from address
 * and user agent inside the aggregation pass, and only the counts leave it.
 *
 * "Visitor-days" rather than "visitors" throughout, because that is what is counted: one address
 * and browser on one calendar day. The same person on two days is two, and the name says so.
 */

/** Hourly up to a day of range, daily beyond. */
export const BUCKET = { hour: "hour", day: "day" } as const;
export type TrafficBucket = (typeof BUCKET)[keyof typeof BUCKET];

export const STATUS_CLASS = { s2xx: "2xx", s3xx: "3xx", s4xx: "4xx", s5xx: "5xx" } as const;
export type StatusClass = (typeof STATUS_CLASS)[keyof typeof STATUS_CLASS];

export type TrafficTotals = {
  visitorDays: number;
  pageViews: number;
  requests: number;
  humanRequests: number;
  botRequests: number;
  scannerRequests: number;
  /** `$body_bytes_sent` summed over every request, whoever sent it. */
  bytes: number;
  /** Link-preview fetches — each one is someone pasting a link to the site somewhere. */
  previews: number;
};

/**
 * One bucket of the series. The counts are `null` when the bucket lies before the retention cut
 * (`available: false`): those requests are gone, which is not the same claim as "none came".
 */
export type TrafficPoint = {
  /** ISO-8601 — the bucket's start in the reader's time zone, which may precede the range. */
  t: string;
  /** A daily bucket the rolling range cuts at either edge. */
  partial: boolean;
  available: boolean;
  /** Each visitor-day counted once, in the bucket of its first page view — so the bars sum to the total. */
  visitorDays: number | null;
  pageViews: number | null;
  botRequests: number | null;
  scannerRequests: number | null;
};

export type PageRow = { route: string; pageViews: number; visitorDays: number };
export type EntryRow = { route: string; visitorDays: number };
export type SourceRow = {
  name: string;
  /** The referrer host behind the name, or `null` for "Direct or unknown". */
  host: string | null;
  visitorDays: number;
  pageViews: number;
  /** The three entry pages this source sent the most visitors to. */
  landings: string[];
};
export type CampaignRow = {
  source: string;
  medium: string | null;
  campaign: string | null;
  visitorDays: number;
  pageViews: number;
};
export type ShareRow = { name: string; visitorDays: number };
export type BotRow = { name: string; preview: boolean; requests: number; lastSeen: string };
export type StatusRow = { class: StatusClass; human: number; automated: number };
export type CodeRow = { code: number; requests: number };
export type BrokenLink = { route: string; source: string; hits: number };
/** A count, never a list — the addresses themselves stay in the raw lines. */
export type ScannerCount = { requests: number; addresses: number };

export type SiteTraffic = {
  service: string;
  bucket: TrafficBucket;
  /** True when the range held more rows than the API reads in one pass; every number is then a floor. */
  partial: boolean;
  retentionDays: number;
  /** The site's own host, inferred from the referrers of its assets. `null` when none carried one. */
  ownHost: string | null;
  totals: TrafficTotals;
  series: TrafficPoint[];
  topPages: PageRow[];
  /** How many pages had views beyond the ones in `topPages`. */
  morePages: number;
  entryPages: EntryRow[];
  sources: SourceRow[];
  campaigns: CampaignRow[];
  browsers: ShareRow[];
  systems: ShareRow[];
  devices: ShareRow[];
  /** Twenty-four human page-view counts, midnight first, in the reader's time zone. */
  hourOfDay: number[];
  bots: BotRow[];
  scanners: ScannerCount;
  status: StatusRow[];
  topCodes: CodeRow[];
  brokenLinks: BrokenLink[];
  meta: Meta;
};

export type SiteSummary = {
  service: string;
  visitorDays: number;
  pageViews: number;
  requests: number;
  /** Human requests over all requests, or `null` with no request at all. */
  humanShare: number | null;
  topSource: string | null;
  /** Visitor-days per bucket, `null` before the retention cut. */
  series: (number | null)[];
};

export type TrafficOverview = {
  sites: SiteSummary[];
  bucket: TrafficBucket;
  meta: Meta;
};
