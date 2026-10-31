/**
 * What the traffic routes return (IKN-83), restated — the authoritative copy is
 * `nest-api/src/contracts/traffic.ts`, like every other contract in this front end.
 *
 * No client address appears in any of these shapes, by design: visitors are counted per day on the
 * server and only the counts arrive here.
 */

import type { Meta } from "@lib/logTypes";

/** Mirrors `contracts/traffic.ts`. Hourly up to a day of range, daily beyond. */
export const BUCKET = { hour: "hour", day: "day" } as const;
export type TrafficBucket = (typeof BUCKET)[keyof typeof BUCKET];

/** Mirrors `contracts/traffic.ts`. */
export const STATUS_CLASS = { s2xx: "2xx", s3xx: "3xx", s4xx: "4xx", s5xx: "5xx" } as const;
export type StatusClass = (typeof STATUS_CLASS)[keyof typeof STATUS_CLASS];

/** Mirrors `contracts/traffic.ts`. */
export type TrafficTotals = {
  visitorDays: number;
  pageViews: number;
  requests: number;
  humanRequests: number;
  botRequests: number;
  scannerRequests: number;
  bytes: number;
  /** Link-preview fetches — someone pasted a link to the site somewhere. */
  previews: number;
};

/** Mirrors `contracts/traffic.ts`. `null` counts lie before the retention cut. */
export type TrafficPoint = {
  t: string;
  partial: boolean;
  available: boolean;
  visitorDays: number | null;
  pageViews: number | null;
  botRequests: number | null;
  scannerRequests: number | null;
};

export type PageRow = { route: string; pageViews: number; visitorDays: number };
export type EntryRow = { route: string; visitorDays: number };
export type SourceRow = {
  name: string;
  host: string | null;
  visitorDays: number;
  pageViews: number;
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
export type ScannerCount = { requests: number; addresses: number };

/** Mirrors `contracts/traffic.ts` — one site's dashboard. */
export type SiteTraffic = {
  service: string;
  bucket: TrafficBucket;
  partial: boolean;
  retentionDays: number;
  ownHost: string | null;
  totals: TrafficTotals;
  series: TrafficPoint[];
  topPages: PageRow[];
  morePages: number;
  entryPages: EntryRow[];
  sources: SourceRow[];
  campaigns: CampaignRow[];
  browsers: ShareRow[];
  systems: ShareRow[];
  devices: ShareRow[];
  hourOfDay: number[];
  bots: BotRow[];
  scanners: ScannerCount;
  status: StatusRow[];
  topCodes: CodeRow[];
  brokenLinks: BrokenLink[];
  meta: Meta;
};

/** Mirrors `contracts/traffic.ts` — one overview card. */
export type SiteSummary = {
  service: string;
  visitorDays: number;
  pageViews: number;
  requests: number;
  humanShare: number | null;
  topSource: string | null;
  series: (number | null)[];
};

/** Mirrors `contracts/traffic.ts`. */
export type TrafficOverview = {
  sites: SiteSummary[];
  bucket: TrafficBucket;
  meta: Meta;
};
