# Iknos — Traffic: who visits the sites, read from nginx

**Date:** 2026-10-31
**Status:** approved 2026-10-31, implemented (uncommitted)
**Ticket:** IKN-83, under epic IKN-28 (M4)
**Builds on:** `2026-09-16-iknos-m4-nginx-ingestion-design.md` (IKN-16 — the `NginxSource`, the
combined-format parser, one service per site through `Service.logGlob`)

---

## 1. Why

IKN-16 answered *can Iknos read who visits the sites*. It can: every site whose vhost writes its
own `access_log … combined` (landing page, Folio, bots, and now Fiducia, FID-46) lands in
`log_entry` as one row per request, `logger = "nginx.access"`. But the only place to read those
rows is the Logs view, one raw line at a time. Nobody learns whether a post brought people in by
scrolling `GET /chapter/2 200` lines.

The user wants to know, per site: **whether anyone came, where they came from, whether a shared
link or post brought them, and what they read.** Traffic is one readable page that answers that,
built from rows Iknos already has.

## 2. Goals, non-goals, anti-goals

**Goals.** Per site, over the selected range:

- visitors and pages viewed per day (per hour when the range is 24h or shorter)
- top pages, and entry pages (the first page a visitor opened)
- referrers grouped by source (Google, LinkedIn, Hacker News…), plus `utm_` campaign tags
- humans vs bots, with the bots named, and vulnerability scanners set apart from both
- browsers, operating systems, mobile vs desktop
- status breakdown, and broken links: the 404s humans hit, with who sent them there
- page views by hour of day, and bandwidth served
- an overview across all sites, to compare them and to pick one

**Non-goals (v1).**

- **Countries.** It needs a GeoIP database shipped with the API. Country level would be
  acceptable under the constraint in §3, but it is its own piece of work. Follow-up.
- Comparing with the previous period. With 14 days kept, "this week vs last week" only works for
  ranges of 7 days or less. Follow-up if wanted.
- Live "who is on the site now".
- Counting client-side navigations inside Next.js sites. Those are RSC fetches (`?_rsc=`) and look
  the same as link prefetches in an access log. §5.2.
- Any change to the sites themselves, or to the nginx log format.

**Anti-goals: what would make this a failure even if it works.**

- **Anything that would need a consent banner.** No script, cookie, pixel or fingerprint on the
  sites. No identifier that follows one person from one day to the next, stored or derivable.
  §3.
- Numbers that look precise and aren't. Bots counted as visitors, assets counted as pages, or a
  site's own pages listed as its top referrer.
- A page that reads like a log explorer. This view is for reading at a glance. The raw lines stay
  one click away in Logs.

## 3. The privacy constraint

The user's rule: **only what needs no GDPR consent.** In practice (CNIL's guidance on audience
measurement and on server logs):

- **Server-side only.** Iknos reads logs nginx already writes for operating the server. Nothing is
  added to any site. The cookie/tracker consent rules (ePrivacy art. 82) don't come into play.
- **No identifier across days.** "Visitors" are estimated per calendar day as distinct
  `(ip, user agent)` pairs, computed in memory during a request and discarded with the response.
  No hash, key or visitor id is written anywhere, and none goes into a response. One person on
  two days counts twice. That is the honest consequence, and the UI says "visitors per day", not
  "unique visitors".
- **No IP on the Traffic page.** No payload of the traffic endpoints contains a client address,
  full or truncated. The raw lines in Logs already show IPs (IKN-72), and that stays as it is:
  it is a security tool, under the same 14-day retention.
- **Retention unchanged:** `IKNOS_RETENTION_DAYS=14` drops whole partitions. Traffic stores
  nothing of its own, no rollup or cache table. It is computed on read.

## 4. Where it lives in the app

- **Route** `ROUTES.traffic = "/traffic"`, page at `front/src/app/(app)/traffic/page.tsx`, a mount
  point for `TrafficView` like `metrics/page.tsx`.
- **Rail:** a fifth entry in `VIEWS` (`ServiceRail.tsx`), `key: "traffic"`, label `traffic`,
  `short: "TR"`, `badge: "none"`, after `metrics`.
- **Scope follows the rail and the global range**, like every view:
  - **A site selected** (a service with a `logGlob`): that site's dashboard (§6.2).
  - **`all` selected:** the overview (§6.1). One card per site; clicking a card selects that site
    in the rail (`useSelectedService`).
  - **A service that is not a site** (no `logGlob`, e.g. `pfa-api`): one sentence, in the
    `Notice` style of `MetricsView`. "This service has no nginx access log, so there is no
    traffic to show." Plus the overview's list of sites as links.
- **Range:** the global range (`useTimeRange`). **Add `14d` to `RANGE_KEYS`** so the full
  retention can be read. It is a global key, so every `Record<RangeKey, …>` and every consumer of
  the range has to handle it (the type forces the Records). Bucket choice for Traffic: hourly for
  `15m`/`1h`/`24h`, daily for `7d`/`14d`.

## 5. What gets counted, and how

All of this is pure TypeScript in `nest-api/src/traffic/`, each module with its own `.spec.ts`
and no Nest imports, the same shape as `nginx-parser.ts`.

### 5.1 The rows

```sql
SELECT ts, client_ip, http_method, route, status_code, attrs
  FROM log_entry
 WHERE service = ? AND logger = 'nginx.access' AND ts >= ? AND ts < ?
```

`(service, ts)` is indexed and the range prunes partitions. `attrs` carries `referrer`,
`userAgent`, `bytes`, `query` (IKN-16 §3). A line the parser could not read is stored with
`route`, `status_code` and `attrs` all null (the parser keeps no `degraded` flag), so rows with a
null `status_code` are skipped.

Aggregation happens in Node, not SQL: user-agent classification, the per-day visitor sets and the
time-zone bucketing are all easier and testable there. Volume: a few thousand lines per site per
day, so 14 days is in the tens of thousands of rows. **Budget:** if a site's range holds more than
`TRAFFIC_ROW_CAP` (500 000) rows, the endpoint answers with the cap reached and the UI says the
numbers are partial. That is a guard against a bot storm, not an expected path. Selecting only
the columns above (with `JSON_EXTRACT` for the three `attrs` keys if that is cheaper than the
whole JSON) is left to the builder.

### 5.2 Classifying a request

Each row gets three classifications, in this order:

1. **Audience: `human` | `bot` | `scanner`.**
   - `scanner`: the IP requested at least one **probe path** that day. A fixed list: `wp-login`,
     `wp-admin`, `xmlrpc.php`, `/.env`, `/.git`, `phpmyadmin`, `/cgi-bin`, `.php` on a site that
     serves no PHP, `/vendor/phpunit`, `/actuator`, `/boaform`… Once flagged, **all of that IP's
     requests that day** are `scanner`, including its `GET /`. The list lives in one constant and
     its spec.
   - `bot`: the UA matches a known-crawler or tool pattern (`bot`, `crawl`, `spider`, `slurp`,
     `curl`, `wget`, `python-requests`, `Go-http-client`, `HeadlessChrome`, `axios`, `node-fetch`,
     `facebookexternalhit`, `Slackbot`, `Discordbot`, `WhatsApp`, preview fetchers…), or it is empty
     or `-`.
   - `human`: everything else.
   - **Named bots:** an ordered table of `{ pattern, name }` (Googlebot, Bingbot, Applebot,
     DuckDuckBot, YandexBot, Baiduspider, GPTBot, ClaudeBot, PerplexityBot, CCBot, Bytespider,
     AhrefsBot, SemrushBot, facebookexternalhit → "Facebook preview", Slackbot, LinkedInBot,
     Twitterbot…). Unmatched bots are "Other bots".
   - **Link previews** (Slack, LinkedIn, Twitter, Facebook, Discord, WhatsApp, Telegram) are bots,
     but they are evidence that someone **shared a link**. They get a line of their own in the
     bots table, and they count toward the "shared" signal in §6.2.

2. **Kind: `page` | `asset` | `other`.**
   - `page`: `GET`, and the path has no extension or ends in `.html`/`.htm`, and it is not under
     `/_next/`, `/api/`, `/static/`, `/assets/`, and its query has no `_rsc`.
   - `asset`: has a file extension (`.js .css .png .avif .webp .svg .woff2 .ico .xml .txt .json…`)
     or sits under `/_next/`.
   - `other`: everything else (POST, RSC fetches, `/api/`).
   - `robots.txt`, `sitemap.xml`, `favicon.ico`, `apple-touch-icon*` are assets.

3. **Outcome by status:** 2xx, 3xx, 4xx, 5xx, and `304` counted as a success.

**A page view** is a `human` + `page` request with status 2xx or 304. A redirect (301/302/307/308)
is not a view. The page it leads to will be.

### 5.3 Visitors and entry pages

- **Visitor-day** = a distinct `(day, ip, ua)` among human page views, `day` in the reader's time
  zone (§5.6). Built as a `Map` during the pass, never returned.
- **Entry page** = the route of a visitor-day's earliest page view.
- **Pages per visit** = page views ÷ visitor-days, shown as one number.
- No bounce rate, no visit duration. Neither is measurable from access logs without inventing a
  session timeout, and §2 says no false precision.

### 5.4 Referrers

- Referrers are read from `attrs.referrer` on **human page views** only. An image's referrer is
  the page that loaded it, not a source of traffic.
- **The site's own host is inferred, with no configuration:** it is the most frequent referrer
  host among the site's **asset** requests in the range. Assets are fetched by the site's own
  pages, so that host *is* the site. Referrers on that host are internal navigation. They are left
  out of the referrer table and feed nothing else in v1. If no asset request carries a referrer,
  nothing is treated as internal.
- **Grouping:** the referrer host is mapped to a source name through one table (`google.*` →
  Google, `bing.com` → Bing, `duckduckgo.com` → DuckDuckGo, `t.co`/`x.com`/`twitter.com` → X,
  `linkedin.com`/`lnkd.in` → LinkedIn, `news.ycombinator.com` → Hacker News, `reddit.com` →
  Reddit, `github.com` → GitHub, `facebook.com`/`l.facebook.com` → Facebook,
  `instagram.com` → Instagram, `mastodon.*` and known instances → Mastodon, `bsky.app` →
  Bluesky…). Unmapped hosts show as the bare host (`www.` stripped). No referrer = **"Direct or
  unknown"**.
- Each source row carries its visitor-days, its page views and its top three landing paths, so
  "what did Hacker News send people to" is answered in the row.
- **Campaigns:** `utm_source`, `utm_medium`, `utm_campaign` read from `attrs.query` of human page
  views, grouped by `(source, medium, campaign)` with visitor-days and page views. `ref=` is read
  as `utm_source` when `utm_source` is absent. An empty table is fine and normal.

### 5.5 Browsers, systems, devices

A small hand-written UA classifier (`ua.ts` with a spec), no dependency: browser family (Chrome,
Safari, Firefox, Edge, Opera, Samsung Internet, other), OS (Windows, macOS, iOS, iPadOS, Android,
Linux, ChromeOS, other), device (mobile, tablet, desktop). Major families only, no versions.
Counted over visitor-days, so a reader who opens twenty pages counts once.

### 5.6 Time

- The front sends its IANA time zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`) as
  `tz`. The API validates it (an `Intl.DateTimeFormat` with that zone must construct) and falls
  back to `Europe/Paris` otherwise.
- Days, hour buckets and hour of day are computed in that zone in Node.
- The series is **gap-filled**: a bucket with no request appears with zeros, so a quiet day reads
  as a quiet day and not as a missing one.
- **The range stays rolling** (`now − N`, as `boundsFor` computes it). Nothing is snapped to
  midnight. Daily buckets are calendar days in the reader's zone, so a 7d range has 8 buckets
  and the first and last are partial. The payload marks both, and the chart draws them lighter.
  The daily average is visitor-days ÷ the range's length in days, not ÷ the bucket count.
  *(My call.)*
- **Visitors per bucket:** each visitor-day is counted once, in the bucket of its **first** page
  view. In daily mode that is just the day. In hourly mode the bars therefore sum to the
  headline total, and the tooltip says "visitors arriving". A reader who comes back later the
  same day is in the page views, not in a second visitor bar. *(My call.)*

## 6. The screens

The visual language is the existing work area: `bg-work-ground` with `rounded-card` sections on
`bg-work-surface`, `text-ui`/`text-row`/`text-kicker`, the existing chart primitives
(`AreaSpark`, `BarSpark`, `Sparkline`, `MeterBar`, `DenseTable`, `Tooltip`). Copy lives in
`front/src/text/traffic.ts`, in the tone of `text/metrics.ts`: English, plain, lowercase labels.
The page scrolls inside the work area like the other views (and no overscroll bounce, the user's
global rule).

### 6.1 Overview (`all`)

A heading "Traffic · all sites", the range kicker, then one card per site, sorted by
visitor-days descending. Each card has:

- the site's name,
- visitors per day (total for the range) and page views,
- a `Sparkline` of visitors per bucket,
- the share of requests that were humans (`MeterBar`),
- the top source (the referrer row with the most visitor-days, excluding "Direct or unknown"
  unless it is the only one).

A site with no row in the range shows "no requests in this range", not zeros dressed as data.

### 6.2 One site

Top to bottom:

1. **Header.** "Traffic · fiducia-front", the range kicker, and a link "raw lines in logs" that
   opens Logs on that service (`logsHref`). Logs has no `logger` filter, so a site that also posts
   browser errors shows those lines too.
2. **Headline tiles** (one row, wrapping on narrow widths): visitors per day (summed over the
   range, with the daily average underneath when the range is daily), page views, pages per visit,
   human share of requests, **shared links** (number of link-preview fetches: someone posted a link
   to the site somewhere), bandwidth served (humans + bots, `bytes` summed, formatted).
3. **Visitors over time.** One chart: visitor-days and page views per bucket as bars, with bot and
   scanner requests per bucket as a quieter secondary series, toggleable. Tooltip with exact
   numbers.
4. **Two columns** (one below `--breakpoint-rail`):
   - **Top pages:** path, page views, visitor-days. Up to 20 rows, then "and N more".
   - **Entry pages:** path, visitor-days that started there.
   - **Sources:** source name, visitor-days, page views, top landing paths (§5.4).
   - **Campaigns:** shown only if non-empty.
   - **Browsers / systems / devices:** three short lists with share bars.
   - **Hour of day:** 24 bars of human page views, in the reader's time zone.
   - **Bots:** named bot, requests, last seen. Link previews grouped first. Scanners as one
     line: "scanners: N requests from M addresses". Addresses are counted, never listed (§3).
   - **Status:** requests per class (2xx, 3xx, 4xx, 5xx) split human vs bot/scanner, and the five
     most frequent exact codes.
   - **Broken links:** human 404s grouped by `(path, referrer source)`, with counts. Only paths
     that real people hit, so scanner noise stays out.
5. Every path in a table links to Logs, filtered to that service and route (`logsHref`), so any
   number can be checked against the raw lines.

**States** follow `MetricsView`: `Pending` "reading" while loading, the error text with "retry",
and an empty-range sentence when the site has no rows.

## 7. API

New module `nest-api/src/traffic/`, contracts in `nest-api/src/contracts/traffic.ts`, restated in
the front's types as the contracts' header says.

| Route | Answers |
|---|---|
| `GET /api/traffic?from&to&tz` | the overview: one `SiteSummary` per enabled service with a `logGlob` |
| `GET /api/services/:name/traffic?from&to&tz` | one site's `SiteTraffic` (§6.2). 404 if the service is unknown, 422 if it has no `logGlob` |

`from`/`to` are mandatory and validated like the log routes' (partition pruning, IKN-19). The span
is **not** rejected for exceeding retention: Logs and Metrics accept any range, and Traffic does
the same, up to 31 days. Past that it answers 400, because no screen asks for it and the bucket
grid would cost real CPU. The payload carries `retentionDays` (`IKNOS_RETENTION_DAYS`), and when `from` is older
than that, the view says under the header "logs are kept N days: older requests are gone" and
draws the buckets before the cut-off as unavailable, not as zeros. Retention is configurable:
production has 14, a dev `.env` may have 7. *(My call.)* Both routes sit behind the session guard like every other read.
One payload per site rather than one route per table: the whole page is one pass over the same
rows, and the hook polls it on `SIGNALS_POLL_MS` like `useRouteList`.

Payload sketch (the builder owns the exact field names):

```ts
type SiteTraffic = {
  service: string;
  bucket: "hour" | "day";
  partial: boolean;                       // TRAFFIC_ROW_CAP reached
  ownHost: string | null;                 // §5.4, shown nowhere but useful in a tooltip
  totals: { visitorDays; pageViews; requests; humanRequests; botRequests; scannerRequests; bytes; previews };
  series: { t; visitorDays; pageViews; botRequests; scannerRequests }[];
  topPages: { route; pageViews; visitorDays }[];
  entryPages: { route; visitorDays }[];
  sources: { name; host | null; visitorDays; pageViews; landings: string[] }[];
  campaigns: { source; medium | null; campaign | null; visitorDays; pageViews }[];
  browsers / systems / devices: { name; visitorDays }[];
  hourOfDay: number[24];
  bots: { name; preview: boolean; requests; lastSeen }[];
  scanners: { requests; addresses };     // a count, never a list
  status: { class; human; automated }[]; topCodes: { code; requests }[];
  brokenLinks: { route; source; hits }[];
  meta: Meta;
};
```

Enum-like values (`audience`, `kind`, `bucket`, status class) are `as const` objects on both
sides, per the user's React and code rules.

## 8. Code rules this has to respect

From the user's global instructions: no `useMemo`/`useCallback`/`memo` in new code; enum values
as `as const` objects with derived types; Tailwind on its own scale and design tokens (any new
colour, such as a bot/scanner tone in the chart, goes in `styles/tokens/colors.css` and passes
`pnpm contrast`); exported types in `interfaces/` folders (`components/traffic/interfaces/…`,
`lib/interfaces/trafficTypes.ts`); at most three parameters per function; components split by
job (`components/traffic/overview/`, `components/traffic/site/`, hooks in `lib/`). Nothing is
committed: the work is left in the tree for the user's review.

## 9. Tests

- `nest-api`: specs for the classifier (audience, kind, named bots, previews, probe paths), the
  UA parser, the referrer grouping and own-host inference, the visitor-day and entry-page logic,
  the time-zone bucketing and gap-filling, and the whole aggregation over a fixture of
  combined-format lines (realistic: a human session, Googlebot, a Slack preview, a wp-login
  scanner, an RSC prefetch, a 404 from an external link). Controller validation (`tz`, span,
  unknown service, no `logGlob`).
- `front`: specs for the formatting helpers in `lib/`, and the existing `markup.spec.ts` pattern
  where it applies. `pnpm lint`, `pnpm typecheck`, `pnpm test` pass in both packages.

## 10. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Computed on read, no rollup table | Tens of thousands of rows per site per range, and storing nothing keeps §3 trivially true |
| D2 | Aggregation in Node, not SQL | UA classification, per-day visitor sets and time zones are clearer and testable in TS (*my call*) |
| D3 | Visitors = distinct `(day, ip, ua)`, never stored or returned | The only count that needs no identifier across days (§3) |
| D4 | Scanner = IP that hit a probe path that day, all its requests | One probe means the rest of its traffic is the same scan (*my call*) |
| D5 | Site's own host inferred from asset referrers | No new column, no migration, and the seed (another session's open edit) stays untouched (*my call*) |
| D6 | `14d` added to the global range, as a fixed key | Production keeps 14 days and the range is global by design. A shorter configured retention is explained on screen, not hidden (§7) (*my call*) |
| D10 | Rolling range, calendar-day buckets, partial edges marked | Keeps one meaning of "7d" across every view (*my call*) |
| D11 | A visitor-day counted in the bucket of its first page view | Hourly bars add up to the headline (*my call*) |
| D7 | Link previews counted as "shared links" | They are the one trace a share leaves in an access log (*my call*) |
| D8 | Countries deferred | Needs a GeoIP database. Fine under §3 at country level, but its own ticket |
| D9 | Hand-written UA classifier, no dependency | Major families only. `ua-parser-js` v2 is AGPL (*my call*) |
