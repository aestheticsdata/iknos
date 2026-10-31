import type { SiteTraffic, TrafficBucket } from "@contracts/traffic";
import type { AUDIENCE, KIND } from "../classify";
import type { DEVICE } from "../ua";

/**
 * The shapes the traffic pass works on (IKN-83).
 *
 * The `attrs` values arrive through `JSON_EXTRACT` and are `unknown` on purpose: `attrs` is a JSON
 * column every writer may fill, and the aggregation narrows each one rather than trusting it.
 */

/** One `nginx.access` row as the traffic query returns it. */
export type AccessRow = {
  ts: Date;
  clientIp: string | null;
  httpMethod: string | null;
  route: string | null;
  statusCode: number | null;
  referrer: unknown;
  userAgent: unknown;
  bytes: unknown;
  query: unknown;
};

/** The question: which instants, in which zone, against which retention, as of when. */
export type TrafficWindow = {
  from: Date;
  to: Date;
  tz: string;
  retentionDays: number;
  now: Date;
};

/** The window minus what the service knows by itself — the retention comes from the environment. */
export type TrafficQuery = Omit<TrafficWindow, "retentionDays">;

/** How a timestamp is turned into a bucket key. */
export type KeyCtx = { tz: string; bucket: TrafficBucket };

/** One bucket of the grid, before anything is counted into it. */
export type Slot = { t: string; key: string; partial: boolean; available: boolean };

/** What the pure pass produces; the service adds the rest. */
export type SiteTrafficBody = Omit<SiteTraffic, "service" | "partial" | "retentionDays" | "meta">;

export type Audience = (typeof AUDIENCE)[keyof typeof AUDIENCE];
export type Kind = (typeof KIND)[keyof typeof KIND];
export type Device = (typeof DEVICE)[keyof typeof DEVICE];

/** A crawler, tool or link-preview fetcher, as the bots table names it. */
export type BotIdentity = { name: string; preview: boolean };

/** The three request-line facts that decide whether a request was a page. */
export type KindInput = { method: string | null; route: string | null; query: string | null };

/** What a user agent says about the reader's setup. */
export type UaFacts = { browser: string; os: string; device: Device };

/** A landing page's `utm_` tags, or `ref=` standing in for the source. */
export type Campaign = { source: string; medium: string | null; campaign: string | null };
