# Traffic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Traffic view in Iknos that turns the nginx access-log rows already in `log_entry` into a readable per-site visitor dashboard and an all-sites overview (IKN-83).

**Architecture:** One raw query per site pulls the `nginx.access` rows of the range. A pure aggregation pass in `nest-api/src/traffic/` classifies each request (audience, kind), counts visitor-days in memory and returns one `SiteTraffic` payload. The front polls it with `usePolledResource` and draws it with the existing work-area primitives.

**Tech Stack:** NestJS 12 + Prisma 7 (`$queryRaw`, MySQL), Vitest; Next 16 App Router, React 19 (Compiler), nuqs, Tailwind 4, Biome.

**Spec:** `docs/superpowers/specs/2026-10-31-iknos-traffic-design.md`

## Global Constraints

- No `useMemo`, `useCallback` or `memo` in new code.
- Enum-like sets as `as const` objects with derived types (`AUDIENCE`, `KIND`, `BUCKET`, `STATUS_CLASS`), compared through the constant everywhere, tests included.
- Tailwind on its own scale. New colours only as tokens in `front/styles/tokens/colors.css`.
- Exported front types live in `interfaces/` (`front/src/lib/interfaces/trafficTypes.ts`). In `nest-api`, follow its kebab-case convention: `src/traffic/interfaces/traffic-types.ts`, contracts in `src/contracts/traffic.ts`.
- At most three parameters per function. Past that, one object of a named type. No inline object types in new signatures.
- No overscroll bounce: any new scroller relies on the base `*` rule. Check `front/styles/base.css` has `overscroll-behavior-y: none` on `*`, and add it there if it is missing.
- No IP, full or truncated, in any traffic payload (spec §3). Visitor keys live only inside the aggregation pass.
- Copy in `front/src/text/traffic.ts`: English, lowercase labels, the tone of `text/metrics.ts`.
- Nothing is committed. Work stays in the tree for the user's review. Do not touch `nest-api/prisma/seed.ts` (another session's open edit).

## Review Focus

1. **Time zones:** a request at 23:30 UTC on a Paris reader's dashboard falls on the next local day. Test in `buckets.spec.ts`.
2. **A site with zero rows in range:** gap-filled zeros, `ownHost: null`, empty tables, no division by zero in pages per visit. Test in `aggregate.spec.ts`.
3. **Malformed `attrs`:** a row with `attrs = null`, or a non-string `userAgent`/`referrer`/`query`. It is classified as a bot with an empty UA, and nothing throws. Test in `aggregate.spec.ts`.
4. **An unparsable referrer** (`"-"`, `"android-app://…"`, garbage) maps to "Direct or unknown" or to the bare value without throwing. Test in `referrer.spec.ts`.
5. **Range older than retention:** buckets before `to − retentionDays` are `null`, not 0, and the payload says so. Test in `buckets.spec.ts`.

---

### Task 1: Classification modules (API, pure)

**Files:**
- Create: `nest-api/src/traffic/classify.ts`, `classify.spec.ts`
- Create: `nest-api/src/traffic/ua.ts`, `ua.spec.ts`
- Create: `nest-api/src/traffic/referrer.ts`, `referrer.spec.ts`

**Interfaces (Produces):**
- `AUDIENCE = { human, bot, scanner }`, `KIND = { page, asset, other }` (as const, types `Audience`, `Kind`)
- `isProbePath(route: string): boolean`
- `botName(ua: string): { name: string; preview: boolean } | null`: `null` means not a bot. An empty UA or `-` gives `{ name: "Unknown client", preview: false }`.
- `requestKind(r: KindInput): Kind` with `KindInput = { method: string | null; route: string | null; query: string | null }`
- `parseUa(ua: string): { browser: string; os: string; device: Device }`, `DEVICE = { mobile, tablet, desktop }`
- `refererHost(referrer: string | null): string | null`: lowercased, `www.` stripped, `null` for `-`/empty/unparsable or non-http(s)
- `sourceName(host: string | null): string`: the mapping table. `null` gives `DIRECT_SOURCE = "Direct or unknown"`.
- `campaignOf(query: string | null): { source: string; medium: string | null; campaign: string | null } | null`

- [ ] **Step 1:** Write the specs. Pin these:
  - `isProbePath("/wp-login.php")`, `"/.env"`, `"/.git/config"`, `"/xmlrpc.php"`, `"/phpmyadmin/"`, `"/cgi-bin/x"`, `"/index.php"`, `"/vendor/phpunit/x"`, `"/actuator/health"`, `"/boaform/admin"` are true. `"/"`, `"/chapter/2"` and `"/about"` are false.
  - `botName` gives Googlebot, Bingbot, GPTBot, ClaudeBot. `"Slackbot-LinkExpanding 1.0"` gives `{ name: "Slack preview", preview: true }`, LinkedInBot gives a preview, `facebookexternalhit` gives "Facebook preview". `curl/8.4.0` gives `{ name: "curl", preview: false }`. A generic `"SomethingBot/1.0"` gives "Other bots". Desktop Chrome and iPhone Safari UAs give `null`.
  - `requestKind`: `GET /` is page, `GET /about` is page, `GET /x.html` is page. `GET /_next/static/a.js` is asset, `GET /logo.avif` is asset, `GET /robots.txt` is asset. `GET /chapter` with query `_rsc=abc` is other, `POST /api/x` is other, `GET /api/x` is other.
  - `parseUa`: an iPhone Safari UA gives `{ browser: "Safari", os: "iOS", device: DEVICE.mobile }`, Windows Chrome gives Chrome/Windows/desktop, an Android Firefox phone gives Firefox/Android/mobile, iPad gives tablet with os "iPadOS", Edge gives "Edge" (not Chrome), Samsung Internet gives "Samsung Internet".
  - `refererHost("https://www.google.com/")` is `"google.com"`. `"-"`, `""`, `"android-app://com.slack"` and `"not a url"` are `null`.
  - `sourceName`: `google.fr` is Google, `t.co` is X, `lnkd.in` is LinkedIn, `news.ycombinator.com` is Hacker News, `bsky.app` is Bluesky, `example.org` is `"example.org"`, `null` is `"Direct or unknown"`.
  - `campaignOf("utm_source=newsletter&utm_medium=email&utm_campaign=oct")` gives the triple. `"ref=producthunt"` gives `{ source: "producthunt", medium: null, campaign: null }`. `"page=2"` and `null` give `null`.
- [ ] **Step 2:** `cd nest-api && pnpm vitest run src/traffic`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement. Pattern tables are module constants, ordered (previews and named bots before the generic `bot|crawl|spider` catch-all). Edge is tested before Chrome, and Chrome before Safari.
- [ ] **Step 4:** Re-run. Expected: PASS.

### Task 2: Buckets and aggregation (API, pure)

**Files:**
- Create: `nest-api/src/traffic/interfaces/traffic-types.ts`: `AccessRow` (the query's row shape), `TrafficWindow`
- Create: `nest-api/src/contracts/traffic.ts`, exported from `contracts/index.ts`
- Create: `nest-api/src/traffic/buckets.ts`, `buckets.spec.ts`
- Create: `nest-api/src/traffic/aggregate.ts`, `aggregate.spec.ts`

**Interfaces:**
- Consumes: everything Task 1 produces.
- `AccessRow = { ts: Date; clientIp: string | null; httpMethod: string | null; route: string | null; statusCode: number | null; referrer: unknown; userAgent: unknown; bytes: unknown; query: unknown }`. The JSON-extracted values are `unknown` and narrowed in `aggregate`.
- `TrafficWindow = { from: Date; to: Date; tz: string; retentionDays: number; now: Date }`
- `BUCKET = { hour, day }`, `bucketFor(from: Date, to: Date): Bucket`: hour when the span is ≤ 24 h + 1 min, day otherwise.
- `bucketGrid(window: TrafficWindow): Slot[]` with `Slot = { t: string; key: string; partial: boolean; available: boolean }`. `t` is the ISO start of the bucket in `tz`. `key` is the local `YYYY-MM-DD` or `YYYY-MM-DDTHH`. `partial` is true for daily edges cut by the range. `available` is false when the slot ends before `now − retentionDays`.
- `localKey(ts: Date, ctx: KeyCtx): string` with `KeyCtx = { tz: string; bucket: Bucket }`, and `localHour(ts: Date, tz: string): number`, both through cached `Intl.DateTimeFormat` instances.
- `safeTimeZone(tz: string | undefined): string`: the zone if `Intl` accepts it, else `"Europe/Paris"`.
- `aggregate(rows: AccessRow[], window: TrafficWindow): SiteTrafficBody`. This is `SiteTraffic` without `service`, `partial`, `retentionDays` and `meta`, which the service adds.
- Contracts (`contracts/traffic.ts`), field names fixed here:

```ts
export const STATUS_CLASS = { s2xx: "2xx", s3xx: "3xx", s4xx: "4xx", s5xx: "5xx" } as const;
export type TrafficTotals = { visitorDays: number; pageViews: number; requests: number; humanRequests: number;
  botRequests: number; scannerRequests: number; bytes: number; previews: number };
export type TrafficPoint = { t: string; partial: boolean; available: boolean; visitorDays: number | null;
  pageViews: number | null; botRequests: number | null; scannerRequests: number | null };
export type PageRow = { route: string; pageViews: number; visitorDays: number };
export type EntryRow = { route: string; visitorDays: number };
export type SourceRow = { name: string; host: string | null; visitorDays: number; pageViews: number; landings: string[] };
export type CampaignRow = { source: string; medium: string | null; campaign: string | null; visitorDays: number; pageViews: number };
export type ShareRow = { name: string; visitorDays: number };
export type BotRow = { name: string; preview: boolean; requests: number; lastSeen: string };
export type StatusRow = { class: StatusClass; human: number; automated: number };
export type BrokenLink = { route: string; source: string; hits: number };
export type SiteTraffic = { service: string; bucket: Bucket; partial: boolean; retentionDays: number; ownHost: string | null;
  totals: TrafficTotals; series: TrafficPoint[]; topPages: PageRow[]; morePages: number; entryPages: EntryRow[];
  sources: SourceRow[]; campaigns: CampaignRow[]; browsers: ShareRow[]; systems: ShareRow[]; devices: ShareRow[];
  hourOfDay: number[]; bots: BotRow[]; scanners: { requests: number; addresses: number };
  status: StatusRow[]; topCodes: { code: number; requests: number }[]; brokenLinks: BrokenLink[]; meta: Meta };
export type SiteSummary = { service: string; visitorDays: number; pageViews: number; humanShare: number | null;
  topSource: string | null; series: (number | null)[]; requests: number };
export type TrafficOverview = { sites: SiteSummary[]; bucket: Bucket; meta: Meta };
```

Aggregation algorithm (the parts the signatures do not determine):

1. Skip rows with `statusCode === null` (unparsed lines).
2. First pass: per `(localDay, ip)`, mark scanner if any row's route `isProbePath`. Count scanner addresses as distinct `(day, ip)` pairs.
3. Second pass per row: audience is scanner if marked, else bot if `botName(ua)` is non-null, else human. Then kind. Bytes go to `totals.bytes` for every audience. Previews are counted from `botName(...).preview`.
4. `ownHost` = the most frequent `refererHost` among `KIND.asset` rows (ties broken alphabetically), or `null`.
5. A page view is human + page + status 2xx or 304. Its visitor key is `${localDay}\u0000${ip}\u0000${ua}`. On first sight, record the entry route, the bucket key of this first view (series `visitorDays` is counted there, spec §5.6), the source (from the first view's referrer, ignoring `ownHost`), the UA parse and the campaign. Rows must be processed in `ts` order (the query orders by `ts`).
6. A source row's `landings` holds its three most frequent entry routes. `topPages` keeps 20 rows, sorted by pageViews descending then route, with `morePages` = the remainder count. `entryPages` and `sources` keep 20 rows, `brokenLinks` 20, `bots` all, `topCodes` 5.
7. Broken links: human rows with status 404 and kind page or other, keyed by `(route, sourceName(refererHost(referrer)))` with ownHost mapped to `"this site"`.
8. Series values for slots with `available: false` are `null`.

- [ ] **Step 1:** Write `buckets.spec.ts`:
  - `bucketFor` gives hour for 24 h and day for 7 d.
  - Paris zone: `localKey(new Date("2026-10-30T23:30:00Z"), { tz: "Europe/Paris", bucket: BUCKET.day })` is `"2026-10-31"`.
  - A 7-day rolling grid starting at 10:00 local has 8 slots, the first and last `partial: true`.
  - With `retentionDays: 7` and a 14-day range, the first 7 slots are `available: false`.
  - `safeTimeZone("Mars/Base")` is `"Europe/Paris"`, and `safeTimeZone("America/New_York")` passes through.
  - The 2026-10-25 DST change gives a day of 25 hours that is still one slot.
- [ ] **Step 2:** Write `aggregate.spec.ts` with a fixture built by a local `row()` helper:
  - A human on Chrome views `/` (referrer `https://news.ycombinator.com/`), then `/about` (referrer = own host), and loads two assets with referrer `https://fiducia.example/`.
  - Googlebot gets `/`.
  - A Slack preview gets `/`.
  - Scanner IP 9.9.9.9 gets `/wp-login.php` (404) and `/` (200).
  - The same human gets an RSC fetch `/about` with query `_rsc=1`.
  - A second human gets `/missing` (404) with referrer `https://t.co/x`.

  Assert:
  - `totals.visitorDays === 1` (the 404 visitor made no page view) and `totals.pageViews === 2`.
  - `ownHost === "fiducia.example"`.
  - `sources[0]` is `{ name: "Hacker News", visitorDays: 1, landings: ["/"] }`.
  - `scanners` is `{ requests: 2, addresses: 1 }`. Bots include Googlebot, and "Slack preview" with `preview: true`. `totals.previews === 1`.
  - `entryPages` is `[{ route: "/", visitorDays: 1 }]`.
  - `brokenLinks` is `[{ route: "/missing", source: "X", hits: 1 }]`.
  - No string in `JSON.stringify(result)` contains `"9.9.9.9"` or the human's IP.
  - Empty input: all totals 0, `ownHost: null`, the series gap-filled.
  - `attrs` values that are numbers or objects don't throw.
- [ ] **Step 3:** `pnpm vitest run src/traffic`. Expected: FAIL.
- [ ] **Step 4:** Implement `buckets.ts`, `aggregate.ts` and the contracts. Split helpers inside `aggregate.ts` into small functions taking one `Tally` accumulator object, keeping each signature at three parameters or fewer.
- [ ] **Step 5:** Re-run. Expected: PASS. Then `pnpm typecheck && pnpm check`.

### Task 3: Endpoints (API)

**Files:**
- Create: `nest-api/src/traffic/traffic.service.ts`, `traffic.controller.ts`, `traffic.module.ts`
- Modify: `nest-api/src/app.module.ts` (import `TrafficModule`)
- Modify: `nest-api/src/contracts/service.ts` (add `site: boolean`), `nest-api/src/logs/services.controller.ts` (select `logGlob`, map `site: logGlob !== null`), and the services spec/e2e that pins the shape, if one does
- Test: `nest-api/test/traffic.e2e-spec.ts`

**Interfaces:**
- Consumes: `aggregate`, `bucketFor`, `safeTimeZone`, `summarize` (below), and `parseWindow` from `@logs/log-query`.
- `TrafficService.site(name: string, window: TrafficWindow): Promise<Omit<SiteTraffic, "meta">>`, and `overview(window: TrafficWindow): Promise<Omit<TrafficOverview, "meta">>`
- `summarize(traffic: SiteTrafficBody): Omit<SiteSummary, "service">` in `aggregate.ts`. `topSource` is the first source that is not `DIRECT_SOURCE`, or `DIRECT_SOURCE` when it is the only one.
- `TRAFFIC_ROW_CAP = 500_000`. The query uses `LIMIT cap + 1`, and `partial` is `rows.length > cap`.
- Query (Prisma `$queryRaw`):

```sql
SELECT ts, client_ip AS clientIp, http_method AS httpMethod, route, status_code AS statusCode,
       JSON_UNQUOTE(JSON_EXTRACT(attrs, '$.referrer')) AS referrer,
       JSON_UNQUOTE(JSON_EXTRACT(attrs, '$.userAgent')) AS userAgent,
       JSON_EXTRACT(attrs, '$.bytes') AS bytes,
       JSON_UNQUOTE(JSON_EXTRACT(attrs, '$.query')) AS query
  FROM log_entry
 WHERE service = ${name} AND logger = 'nginx.access' AND ts >= ${from} AND ts < ${to}
 ORDER BY ts
 LIMIT ${TRAFFIC_ROW_CAP + 1}
```

- Controller `@Controller("api")`:
  - `GET traffic` takes `TrafficQueryDto { from?, to?, tz? }` (strings, `@MaxLength(64)` on tz).
  - `GET services/:service/traffic` gives 404 `unknown service '<name>'` when the service is missing or disabled, and 422 (`UnprocessableEntityException`) `'<name>' has no nginx access log` when `logGlob` is null.
  - Both add `meta.tookMs` as `service-view.controller.ts` does.
- Module: the service is built by a factory with `parseEnv(...).retentionDays`, like `MetricsModule`.

- [ ] **Step 1:** Write `test/traffic.e2e-spec.ts` on the `host.e2e-spec.ts` pattern:
  - Create a service row `traffic-e2e-site` with `logGlob`, and seed 6 `log_entry` rows (two human page views, one asset, one Googlebot, one scanner probe, one unparsed row with null status) two hours back.
  - Assert `GET /api/services/traffic-e2e-site/traffic?from&to&tz=Europe/Paris` gives 200 with `totals.pageViews === 2`, `bots[0].name === "Googlebot"`, `scanners.addresses === 1`, and that the body contains no seeded IP.
  - A service without `logGlob` gives 422. `nope` gives 404. Missing `from` gives 400.
  - `GET /api/traffic` includes `traffic-e2e-site`.
  - `GET /api/services` gives `site: true` for it.
  - Clean up the rows in `afterAll`.
- [ ] **Step 2:** Run `pnpm vitest run test/traffic.e2e-spec.ts` (needs the local MySQL and Redis that the other e2e specs use). Expected: FAIL (404 route).
- [ ] **Step 3:** Implement the service, the controller, the module and the `site` flag.
- [ ] **Step 4:** Re-run. Expected: PASS. Then run the full `pnpm test && pnpm typecheck && pnpm check` in `nest-api`.

### Task 4: Front plumbing (range, route, rail, types, hook)

**Files:**
- Modify: `front/src/lib/timeRange.ts`: add `"14d"` to `RANGE_KEYS` and `MINUTES` (`14 * 24 * 60`). Fix every `Record<RangeKey, …>` and `RangeKey` switch that `pnpm typecheck` then reports, and any spec that enumerates the keys.
- Modify: `front/src/lib/routes.ts` (`traffic: "/traffic"`), `front/src/components/chassis/ServiceRail.tsx` (a `VIEWS` entry after metrics: `{ key: "traffic", label: CHASSIS_TEXT.viewTraffic, href: ROUTES.traffic, short: "TR", badge: "none" }`), `front/src/text/chassis.ts` (`viewTraffic: "traffic"`)
- Modify: `front/src/lib/services.ts` / `serviceTypes.ts`, wherever the front restates `Service`: add `site: boolean`
- Create: `front/src/lib/interfaces/trafficTypes.ts`: a restatement of `contracts/traffic.ts`, plus `BUCKET` and `STATUS_CLASS` as const
- Create: `front/src/lib/useTraffic.ts`: `useSiteTraffic(service: string | null, range: RangeKey)` and `useTrafficOverview(active: boolean, range: RangeKey)`. Both use `useSlidingBounds(range, SIGNALS_POLL_MS)` and `usePolledResource`, with identity `${service} ${range}` / `overview ${range}`, and append `tz=` from `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- Create: `front/src/lib/trafficFormat.ts`, `trafficFormat.spec.ts`
- Create: `front/src/text/traffic.ts`

**Interfaces (Produces):**
- `formatShare(share: number | null): string` (`0.734` gives `"73%"`, `null` gives the existing `ABSENT` glyph from `format.ts`)
- `pagesPerVisit(totals: TrafficTotals): string` (`"1.8"`, or `ABSENT` when visitorDays is 0)
- `bucketLabel(point: TrafficPoint, bucket: Bucket): string` (day: `"Fri 31 Oct"`, hour: `"14:00"`, `" (partial)"` appended when partial)
- `dailyAverage(totals: TrafficTotals, range: RangeKey): number | null` (visitorDays ÷ range days, `null` for hourly ranges)
- `retentionCut(range: RangeKey, retentionDays: number): boolean` (true when the range is longer than the retention)

- [ ] **Step 1:** Write `trafficFormat.spec.ts` with the values above.
- [ ] **Step 2:** `cd front && pnpm vitest run src/lib/trafficFormat.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Then run `pnpm typecheck` and fix every place the new `14d` key reaches.
- [ ] **Step 4:** `pnpm test && pnpm typecheck && pnpm lint`. Expected: PASS.

### Task 5: The Traffic view

**Files:**
- Create: `front/src/app/(app)/traffic/page.tsx` (mount point for `TrafficView`, like `metrics/page.tsx`)
- Create: `front/src/components/traffic/TrafficView.tsx`. It picks overview, site or notice from `useSelectedService` and the services list (`site` flag).
- Create: `front/src/components/traffic/overview/TrafficOverview.tsx`, `overview/SiteCard.tsx`
- Create: `front/src/components/traffic/site/SiteTrafficView.tsx`, `site/SiteHeader.tsx`, `site/HeadlineTiles.tsx`, `site/TrafficChart.tsx`, `site/RankedTable.tsx` (a generic ranked table on `DenseTable` with a share bar), `site/SourcesTable.tsx`, `site/AudiencePanel.tsx` (bots, scanners, previews), `site/StatusPanel.tsx`, `site/HourOfDay.tsx`
- Create: `front/src/components/traffic/interfaces/trafficViewTypes.ts` for any exported props types

Behaviour (spec §6):
- **Overview cards:** sorted by visitorDays. A click calls `useSelectedService()[1](site)`. A site with `requests === 0` shows `TRAFFIC_TEXT.noRequests`.
- **Site:**
  - Header: title `traffic · {service}`, a range kicker, and a "raw lines in logs" link built with `logsHref({ range, values: { service } })`.
  - Tiles: visitors, page views, pages per visit, human share, shared links, bandwidth (`formatBytes`).
  - Chart: three stacked `BarSpark`s (visitors in tone `ok`, page views in `info`, automated requests in `neutral`) with `tip` from `bucketLabel`. Partial slots are drawn through the `null`/stub rules. Unavailable slots are `null`, so they draw nothing.
  - A retention note under the header when `retentionCut`.
  - Tables in a two-column grid that falls to one column below the `rail` breakpoint (`max-rail:` variant). Every route cell is a `Link` to `logsHref({ range, values: { service, route } })`.
  - Campaigns hidden when empty.
- **States:** `Pending` "reading", the error text with retry, and a notice for a non-site service, as in `MetricsView`.
- The work area scrolls with `SURFACE_SCROLL.work`.

- [ ] **Step 1:** Build the components. Keep each one single-purpose, with no helpers inline beyond trivial mappers. Formatting goes through `trafficFormat.ts`.
- [ ] **Step 2:** `pnpm typecheck && pnpm lint && pnpm test`. Expected: PASS.
- [ ] **Step 3:** Run the app (`pnpm dev` in front, with the API dev server), open `/traffic`, and check the overview, one site, a non-site service, and the 24h and 14d ranges, at both desktop and narrow widths. No console errors.

### Task 6: Verification and hand-over

- [ ] Run `pnpm test`, `pnpm typecheck` and `pnpm check` in `nest-api`, and `pnpm test`, `pnpm typecheck` and `pnpm lint` in `front`. All pass.
- [ ] Grep the new front code for `useMemo|useCallback|memo(`, `\[[0-9]+px\]` and `export type` outside `interfaces/`. Nothing found.
- [ ] Move IKN-83 to "In Review", leave everything uncommitted, and report to the user.
