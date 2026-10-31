import { BUCKET, STATUS_CLASS } from "@contracts/traffic";
import { bucketFor, bucketGrid, localHour, localKey } from "./buckets";
import { AUDIENCE, botName, isProbePath, KIND, requestKind } from "./classify";
import { campaignOf, DIRECT_SOURCE, refererHost, sourceName } from "./referrer";
import { parseUa } from "./ua";

import type { BotRow, ShareRow, SiteSummary, StatusClass, TrafficBucket } from "@contracts/traffic";
import type {
  AccessRow,
  Audience,
  BotIdentity,
  Kind,
  SiteTrafficBody,
  TrafficWindow,
} from "./interfaces/traffic-types";

/**
 * One pass over a site's access rows → everything the traffic view draws (IKN-83, spec §5).
 *
 * **The privacy boundary is this function.** Client addresses come in, and are used for exactly
 * two things: marking an address that probed for a known hole as a scanner for the day, and
 * telling one visitor-day from another. Both live in maps local to one call and die with it. What
 * goes out is counts, routes, hosts and bot names — never an address, and never a key derived from
 * one, so nothing in the response can follow a person from one day to the next (spec §3).
 */

const TOP_ROWS = 20;
const TOP_CODES = 5;
const LANDINGS = 3;
/** What a 404's own-site referrer is called in the broken-links table. */
const THIS_SITE = "this site";

/** One request, read once: its narrowed attributes and both classifications. */
type Request = {
  row: AccessRow;
  status: number;
  ua: string;
  referrer: string | null;
  query: string | null;
  bytes: number;
  day: string;
  bucketKey: string;
  kind: Kind;
  audience: Audience;
  bot: BotIdentity | null;
};

/** What is remembered about a visitor-day, all of it decided by its first page view. */
type Visit = { entry: string; source: string; host: string | null; campaign: string | null };

type Counter = Map<string, number>;

/** Everything the pass accumulates. One object, so each step takes it and one request. */
type Tally = {
  ownHost: string | null;
  visits: Map<string, Visit>;
  pageViews: Counter;
  pageVisitors: Map<string, Set<string>>;
  series: Map<string, { visitorDays: number; pageViews: number; botRequests: number; scannerRequests: number }>;
  sources: Map<string, { host: string | null; visitorDays: number; pageViews: number; landings: Counter }>;
  campaigns: Map<
    string,
    { source: string; medium: string | null; campaign: string | null; visitorDays: number; pageViews: number }
  >;
  browsers: Counter;
  systems: Counter;
  devices: Counter;
  entries: Counter;
  hourOfDay: number[];
  bots: Map<string, { preview: boolean; requests: number; lastSeen: Date }>;
  scannerAddresses: Set<string>;
  status: Map<StatusClass, { human: number; automated: number }>;
  codes: Map<number, number>;
  broken: Counter;
  totals: SiteTrafficBody["totals"];
};

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
/* `CAST(… AS SIGNED)` comes back as a bigint from the driver; anything that is not a count is 0. */
const count = (value: unknown): number => {
  if (typeof value === "bigint") return Number(value);
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};
const bump = (counter: Counter, key: string, by = 1) => counter.set(key, (counter.get(key) ?? 0) + by);

const statusClass = (status: number): StatusClass | null => {
  if (status >= 200 && status < 300) return STATUS_CLASS.s2xx;
  if (status >= 300 && status < 400) return STATUS_CLASS.s3xx;
  if (status >= 400 && status < 500) return STATUS_CLASS.s4xx;
  if (status >= 500 && status < 600) return STATUS_CLASS.s5xx;
  return null;
};

const isPageView = (request: Request) =>
  request.audience === AUDIENCE.human &&
  request.kind === KIND.page &&
  ((request.status >= 200 && request.status < 300) || request.status === 304);

/** Sorted by count descending, then by name, so equal rows come back in a stable order. */
const ranked = (counter: Counter) => [...counter.entries()].sort(([a, x], [b, y]) => y - x || a.localeCompare(b));

const shares = (counter: Counter): ShareRow[] => ranked(counter).map(([name, visitorDays]) => ({ name, visitorDays }));

/** First pass: who probed for a hole, per day — every request of that address that day is a scan. */
const scannersByDay = (rows: AccessRow[], window: TrafficWindow) => {
  const flagged = new Set<string>();
  for (const row of rows) {
    if (row.statusCode === null || row.clientIp === null || row.route === null) continue;
    if (isProbePath(row.route))
      flagged.add(`${localKey(row.ts, { tz: window.tz, bucket: BUCKET.day })}\u0000${row.clientIp}`);
  }
  return flagged;
};

const readRequests = (rows: AccessRow[], window: TrafficWindow): Request[] => {
  const bucket = bucketFor(window.from, window.to);
  const scanners = scannersByDay(rows, window);
  /* Rows older than the retention are normally already gone. Where partition maintenance lags (a
     laptop, a paused job), counting them would put requests into the totals that the series draws
     as "gone" — so the cut the chart shows is the cut the numbers obey. */
  const cut = +window.now - window.retentionDays * 86_400_000;
  const requests: Request[] = [];

  for (const row of rows) {
    if (row.statusCode === null || +row.ts < cut) continue;

    const ua = text(row.userAgent) ?? "";
    const query = text(row.query);
    const day = localKey(row.ts, { tz: window.tz, bucket: BUCKET.day });
    const bot = botName(ua);
    const scanner = row.clientIp !== null && scanners.has(`${day}\u0000${row.clientIp}`);

    requests.push({
      row,
      status: row.statusCode,
      ua,
      referrer: text(row.referrer),
      query,
      bytes: count(row.bytes),
      day,
      bucketKey: localKey(row.ts, { tz: window.tz, bucket }),
      kind: requestKind({ method: row.httpMethod, route: row.route, query }),
      audience: scanner ? AUDIENCE.scanner : bot ? AUDIENCE.bot : AUDIENCE.human,
      bot,
    });
  }
  return requests;
};

/**
 * The site's own host: the most frequent referrer of its assets (spec §5.4). An image or a script
 * is fetched by the site's own pages, so whoever refers them *is* the site — no configuration.
 */
const inferOwnHost = (requests: Request[]): string | null => {
  const hosts: Counter = new Map();
  for (const request of requests) {
    if (request.kind !== KIND.asset) continue;
    const host = refererHost(request.referrer);
    if (host !== null) bump(hosts, host);
  }
  return ranked(hosts)[0]?.[0] ?? null;
};

const newTally = (ownHost: string | null): Tally => ({
  ownHost,
  visits: new Map(),
  pageViews: new Map(),
  pageVisitors: new Map(),
  series: new Map(),
  sources: new Map(),
  campaigns: new Map(),
  browsers: new Map(),
  systems: new Map(),
  devices: new Map(),
  entries: new Map(),
  hourOfDay: Array.from({ length: 24 }, () => 0),
  bots: new Map(),
  scannerAddresses: new Set(),
  status: new Map(),
  codes: new Map(),
  broken: new Map(),
  totals: {
    visitorDays: 0,
    pageViews: 0,
    requests: 0,
    humanRequests: 0,
    botRequests: 0,
    scannerRequests: 0,
    bytes: 0,
    previews: 0,
  },
});

const seriesAt = (tally: Tally, key: string) => {
  let point = tally.series.get(key);
  if (!point) {
    point = { visitorDays: 0, pageViews: 0, botRequests: 0, scannerRequests: 0 };
    tally.series.set(key, point);
  }
  return point;
};

/** Every request: totals, audience, status. */
const countRequest = (tally: Tally, request: Request) => {
  const { totals } = tally;
  totals.requests += 1;
  totals.bytes += request.bytes;

  if (request.audience === AUDIENCE.human) totals.humanRequests += 1;
  if (request.audience === AUDIENCE.bot) {
    totals.botRequests += 1;
    seriesAt(tally, request.bucketKey).botRequests += 1;
  }
  if (request.audience === AUDIENCE.scanner) {
    totals.scannerRequests += 1;
    seriesAt(tally, request.bucketKey).scannerRequests += 1;
    if (request.row.clientIp !== null) tally.scannerAddresses.add(request.row.clientIp);
  }

  if (request.audience === AUDIENCE.bot && request.bot !== null) {
    if (request.bot.preview) totals.previews += 1;
    const bot = tally.bots.get(request.bot.name) ?? {
      preview: request.bot.preview,
      requests: 0,
      lastSeen: request.row.ts,
    };
    bot.requests += 1;
    if (request.row.ts > bot.lastSeen) bot.lastSeen = request.row.ts;
    tally.bots.set(request.bot.name, bot);
  }

  const cls = statusClass(request.status);
  if (cls !== null) {
    const split = tally.status.get(cls) ?? { human: 0, automated: 0 };
    if (request.audience === AUDIENCE.human) split.human += 1;
    else split.automated += 1;
    tally.status.set(cls, split);
  }
  tally.codes.set(request.status, (tally.codes.get(request.status) ?? 0) + 1);
};

/** A human 404 on something a person would have followed a link to — not an asset, not a scan. */
const countBrokenLink = (tally: Tally, request: Request) => {
  if (request.audience !== AUDIENCE.human || request.status !== 404 || request.kind === KIND.asset) return;
  if (request.row.route === null) return;

  const host = refererHost(request.referrer);
  const source = host !== null && host === tally.ownHost ? THIS_SITE : sourceName(host);
  bump(tally.broken, `${request.row.route}\u0000${source}`);
};

/** The first page view of a visitor-day decides its entry page, source, campaign and browser. */
const openVisit = (tally: Tally, request: Request, key: string): Visit => {
  const route = request.row.route ?? "/";
  const outside = refererHost(request.referrer);
  const host = outside !== null && outside === tally.ownHost ? null : outside;
  const source = sourceName(host);
  const campaign = campaignOf(request.query);
  const campaignKey = campaign
    ? `${campaign.source}\u0000${campaign.medium ?? ""}\u0000${campaign.campaign ?? ""}`
    : null;

  const visit: Visit = { entry: route, source, host, campaign: campaignKey };
  tally.visits.set(key, visit);
  tally.totals.visitorDays += 1;
  seriesAt(tally, request.bucketKey).visitorDays += 1;
  bump(tally.entries, route);

  const sourceRow = tally.sources.get(source) ?? { host, visitorDays: 0, pageViews: 0, landings: new Map() };
  sourceRow.visitorDays += 1;
  bump(sourceRow.landings, route);
  tally.sources.set(source, sourceRow);

  if (campaign && campaignKey) {
    const row = tally.campaigns.get(campaignKey) ?? { ...campaign, visitorDays: 0, pageViews: 0 };
    row.visitorDays += 1;
    tally.campaigns.set(campaignKey, row);
  }

  const facts = parseUa(request.ua);
  bump(tally.browsers, facts.browser);
  bump(tally.systems, facts.os);
  bump(tally.devices, facts.device);
  return visit;
};

const countPageView = (tally: Tally, request: Request, window: TrafficWindow) => {
  const route = request.row.route ?? "/";
  const key = `${request.day}\u0000${request.row.clientIp ?? ""}\u0000${request.ua}`;
  const visit = tally.visits.get(key) ?? openVisit(tally, request, key);

  tally.totals.pageViews += 1;
  seriesAt(tally, request.bucketKey).pageViews += 1;
  tally.hourOfDay[localHour(request.row.ts, window.tz)] += 1;
  bump(tally.pageViews, route);

  const visitors = tally.pageVisitors.get(route) ?? new Set<string>();
  visitors.add(key);
  tally.pageVisitors.set(route, visitors);

  const source = tally.sources.get(visit.source);
  if (source) source.pageViews += 1;
  const campaign = visit.campaign ? tally.campaigns.get(visit.campaign) : undefined;
  if (campaign) campaign.pageViews += 1;
};

const botRows = (tally: Tally): BotRow[] =>
  [...tally.bots.entries()]
    .map(([name, bot]) => ({
      name,
      preview: bot.preview,
      requests: bot.requests,
      lastSeen: bot.lastSeen.toISOString(),
    }))
    .sort((a, b) => Number(b.preview) - Number(a.preview) || b.requests - a.requests || a.name.localeCompare(b.name));

const STATUS_ORDER: readonly StatusClass[] = Object.values(STATUS_CLASS);

const finish = (tally: Tally, window: TrafficWindow): SiteTrafficBody => {
  const bucket: TrafficBucket = bucketFor(window.from, window.to);
  const pages = ranked(tally.pageViews);

  return {
    bucket,
    ownHost: tally.ownHost,
    totals: tally.totals,
    series: bucketGrid(window).map((slot) => {
      const point = tally.series.get(slot.key);
      const value = (n: number | undefined) => (slot.available ? (n ?? 0) : null);
      return {
        t: slot.t,
        partial: slot.partial,
        available: slot.available,
        visitorDays: value(point?.visitorDays),
        pageViews: value(point?.pageViews),
        botRequests: value(point?.botRequests),
        scannerRequests: value(point?.scannerRequests),
      };
    }),
    topPages: pages.slice(0, TOP_ROWS).map(([route, pageViews]) => ({
      route,
      pageViews,
      visitorDays: tally.pageVisitors.get(route)?.size ?? 0,
    })),
    morePages: Math.max(0, pages.length - TOP_ROWS),
    entryPages: ranked(tally.entries)
      .slice(0, TOP_ROWS)
      .map(([route, visitorDays]) => ({ route, visitorDays })),
    sources: [...tally.sources.entries()]
      .sort(([a, x], [b, y]) => y.visitorDays - x.visitorDays || y.pageViews - x.pageViews || a.localeCompare(b))
      .slice(0, TOP_ROWS)
      .map(([name, row]) => ({
        name,
        host: row.host,
        visitorDays: row.visitorDays,
        pageViews: row.pageViews,
        landings: ranked(row.landings)
          .slice(0, LANDINGS)
          .map(([route]) => route),
      })),
    campaigns: [...tally.campaigns.values()].sort((a, b) => b.visitorDays - a.visitorDays || b.pageViews - a.pageViews),
    browsers: shares(tally.browsers),
    systems: shares(tally.systems),
    devices: shares(tally.devices),
    hourOfDay: tally.hourOfDay,
    bots: botRows(tally),
    scanners: { requests: tally.totals.scannerRequests, addresses: tally.scannerAddresses.size },
    status: STATUS_ORDER.map((cls) => ({ class: cls, ...(tally.status.get(cls) ?? { human: 0, automated: 0 }) })),
    topCodes: [...tally.codes.entries()]
      .sort(([a, x], [b, y]) => y - x || a - b)
      .slice(0, TOP_CODES)
      .map(([code, requests]) => ({ code, requests })),
    brokenLinks: ranked(tally.broken)
      .slice(0, TOP_ROWS)
      .map(([key, hits]) => {
        const [route, source] = key.split("\u0000");
        return { route, source, hits };
      }),
  };
};

/** Rows must arrive in `ts` order — the first page view of a visitor-day is the one that decides it. */
export const aggregate = (rows: AccessRow[], window: TrafficWindow): SiteTrafficBody => {
  const requests = readRequests(rows, window);
  const tally = newTally(inferOwnHost(requests));

  for (const request of requests) {
    countRequest(tally, request);
    countBrokenLink(tally, request);
    if (isPageView(request)) countPageView(tally, request, window);
  }

  return finish(tally, window);
};

/** One overview card out of a site's full payload (spec §6.1). */
export const summarize = (traffic: SiteTrafficBody): Omit<SiteSummary, "service"> => {
  const outside = traffic.sources.find((source) => source.name !== DIRECT_SOURCE);
  const { totals } = traffic;

  return {
    visitorDays: totals.visitorDays,
    pageViews: totals.pageViews,
    requests: totals.requests,
    humanShare: totals.requests > 0 ? totals.humanRequests / totals.requests : null,
    topSource: outside?.name ?? traffic.sources[0]?.name ?? null,
    series: traffic.series.map((point) => point.visitorDays),
  };
};
