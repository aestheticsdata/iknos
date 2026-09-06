/**
 * The mock fleet's characters — shared by the corpus generator (`author.ts`, seeded and
 * deterministic) and the live fleet (`fleet-node.ts`, random by design). One table, so the past
 * the corpus wrote and the present the fleet writes are the same nineteen services with the same
 * routes, latencies and recurring errors: a demo where the last seven days and the next minute
 * disagree about what `atlas-api` does would read as two apps.
 *
 * Pure data and pure helpers. Nothing here reads the clock or the PRNG — that stays with the
 * caller, which is what keeps `author.ts` byte-stable.
 */

/** Where the fleet writes from — every ECS line carries it as `host.hostname`. */
export const HOSTNAME = "web01";

/** Hour-of-day weights: a night trough and an afternoon crest, so the histogram has a curve. */
export const HOUR_WEIGHT = [
  0.22, 0.16, 0.13, 0.12, 0.14, 0.25, 0.45, 0.75, 1.05, 1.3, 1.4, 1.3, 1.1, 1.2, 1.35, 1.4, 1.3, 1.15, 1.0, 0.85, 0.68,
  0.52, 0.4, 0.3,
];

/** Day weights, oldest first — days 2 and 3 are the quiet weekend of the corpus. */
export const DAY_WEIGHT = [1.0, 1.05, 0.55, 0.6, 1.1, 1.15, 1.0];

export type Route = { method: string; route: string; w: number; median: number };

export type Profile = {
  name: string;
  logger: string;
  /** Share of the ~15 000 lines. */
  weight: number;
  /** Share of lines that are `debug` — only some apps run verbose. */
  debug: number;
  routes: Route[];
  events: string[];
};

/**
 * The registry's 19 services (`prisma/seed.ts:84-138`), each with its own volume, routes and
 * latency character — a front and an API of the same product do not write the same lines.
 * Names must match the registry exactly: the tailer keys `log_entry.service` on the PM2 name.
 */
export const PROFILES: Profile[] = [
  {
    name: "atlas-api",
    logger: "atlas",
    weight: 0.115,
    debug: 0.06,
    routes: [
      { method: "GET", route: "/api/expenses", w: 4, median: 38 },
      { method: "GET", route: "/api/expenses/:id", w: 3, median: 22 },
      { method: "POST", route: "/api/expenses", w: 2, median: 55 },
      { method: "GET", route: "/api/reports/monthly", w: 2, median: 140 },
      { method: "GET", route: "/api/categories", w: 1, median: 18 },
    ],
    events: [
      "monthly rollup finished in {n} ms",
      "cache warmed: {n} categories",
      "budget recomputed for month 2026-08",
    ],
  },
  {
    name: "beacon-api",
    logger: "weathr",
    weight: 0.105,
    debug: 0.04,
    routes: [
      { method: "GET", route: "/api/declarations", w: 4, median: 33 },
      { method: "POST", route: "/api/declarations", w: 2, median: 62 },
      { method: "GET", route: "/api/forecast/:city", w: 3, median: 210 },
      { method: "GET", route: "/api/ranking", w: 2, median: 48 },
    ],
    events: ["forecast sync finished: {n} cities", "ranking recomputed in {n} ms", "declaration window rolled over"],
  },
  {
    name: "cinder-api",
    logger: "cinder",
    weight: 0.09,
    debug: 0.05,
    routes: [
      { method: "GET", route: "/api/issues", w: 4, median: 41 },
      { method: "POST", route: "/api/issues", w: 1, median: 74 },
      { method: "PATCH", route: "/api/issues/:id", w: 2, median: 58 },
      { method: "GET", route: "/api/projects", w: 2, median: 25 },
      { method: "GET", route: "/api/labels", w: 1, median: 15 },
    ],
    events: ["issue counter advanced to {n}", "backup dump written: {n} KB", "session store compacted"],
  },
  {
    name: "keystone-api",
    logger: "keystone",
    weight: 0.095,
    debug: 0.07,
    routes: [
      { method: "GET", route: "/api/logs", w: 5, median: 65 },
      { method: "GET", route: "/api/logs/histogram", w: 2, median: 48 },
      { method: "GET", route: "/api/services", w: 2, median: 21 },
      { method: "GET", route: "/api/collector/status", w: 1, median: 8 },
    ],
    events: [
      "flushed {n} rows in one batch",
      "partition maintenance pass finished",
      "scrape cycle: 2 targets, 0 errors",
    ],
  },
  {
    name: "dovetail-api",
    logger: "dovetail",
    weight: 0.08,
    debug: 0.04,
    routes: [
      { method: "GET", route: "/api/fleet", w: 4, median: 95 },
      { method: "POST", route: "/api/deploy-reports", w: 1, median: 30 },
      { method: "GET", route: "/api/cron-jobs", w: 2, median: 27 },
      { method: "GET", route: "/api/db-dumps", w: 1, median: 33 },
    ],
    events: ["fleet sweep finished: {n} services probed", "cron report accepted", "db dump pushed offsite in {n} ms"],
  },
  {
    name: "fathom-api",
    logger: "fathom",
    weight: 0.05,
    debug: 0.03,
    routes: [
      { method: "GET", route: "/api/bookmarks", w: 4, median: 29 },
      { method: "POST", route: "/api/bookmarks", w: 1, median: 47 },
      { method: "GET", route: "/api/tags", w: 1, median: 14 },
    ],
    events: ["favicon cache pruned: {n} entries", "import finished: {n} bookmarks"],
  },
  {
    name: "ember-api",
    logger: "ember",
    weight: 0.055,
    debug: 0.05,
    routes: [
      { method: "GET", route: "/api/listing", w: 4, median: 52 },
      { method: "POST", route: "/api/transfers", w: 1, median: 88 },
      { method: "GET", route: "/api/scans/:id", w: 1, median: 36 },
    ],
    events: ["disk scan finished: {n} entries", "sha256 job done in {n} ms", "retention pass pruned {n} rows"],
  },
  {
    name: "harbor-api",
    logger: "harbor",
    weight: 0.03,
    debug: 0.02,
    routes: [
      { method: "GET", route: "/api/scores", w: 3, median: 12 },
      { method: "POST", route: "/api/scores", w: 1, median: 24 },
    ],
    events: ["daily leaderboard rebuilt"],
  },
  {
    name: "gale-api",
    logger: "chat",
    weight: 0.035,
    debug: 0.03,
    routes: [
      { method: "GET", route: "/api/messages", w: 3, median: 26 },
      { method: "POST", route: "/api/messages", w: 2, median: 31 },
    ],
    events: ["websocket peers: {n}", "history compacted"],
  },
  {
    name: "ivory-api",
    logger: "ivory",
    weight: 0.02,
    debug: 0.02,
    routes: [{ method: "GET", route: "/api/patterns", w: 1, median: 16 }],
    events: ["pattern library reloaded: {n} patterns"],
  },
  {
    name: "juniper",
    logger: "juniper",
    weight: 0.008,
    debug: 0,
    routes: [{ method: "GET", route: "/api/state", w: 1, median: 9 }],
    events: ["simulation tick drift {n} ms"],
  },
  {
    name: "keystone-front",
    logger: "next",
    weight: 0.05,
    debug: 0.02,
    routes: frontRoutes(["/logs", "/services", "/issues", "/alerts"]),
    events: frontEvents(),
  },
  {
    name: "atlas-front",
    logger: "next",
    weight: 0.045,
    debug: 0.02,
    routes: frontRoutes(["/", "/expenses", "/reports"]),
    events: frontEvents(),
  },
  {
    name: "cinder-front",
    logger: "next",
    weight: 0.04,
    debug: 0.02,
    routes: frontRoutes(["/", "/board", "/issue/:key"]),
    events: frontEvents(),
  },
  {
    name: "dovetail-front",
    logger: "next",
    weight: 0.035,
    debug: 0.02,
    routes: frontRoutes(["/", "/fleet", "/registry"]),
    events: frontEvents(),
  },
  {
    name: "beacon-front",
    logger: "next",
    weight: 0.035,
    debug: 0.02,
    routes: frontRoutes(["/", "/declare", "/ranking"]),
    events: frontEvents(),
  },
  {
    name: "ember-front",
    logger: "next",
    weight: 0.03,
    debug: 0.02,
    routes: frontRoutes(["/", "/browse"]),
    events: frontEvents(),
  },
  {
    name: "fathom-front",
    logger: "next",
    weight: 0.025,
    debug: 0.02,
    routes: frontRoutes(["/", "/tags"]),
    events: frontEvents(),
  },
  {
    name: "gale-front",
    logger: "next",
    weight: 0.022,
    debug: 0.02,
    routes: frontRoutes(["/", "/room/:id"]),
    events: frontEvents(),
  },
];

export function frontRoutes(pages: string[]): Route[] {
  return pages.map((route, i) => ({ method: "GET", route, w: pages.length - i, median: 120 }));
}

export function frontEvents(): string[] {
  return ["page compiled in {n} ms", "revalidated in {n} ms"];
}

/**
 * Documentation ranges only (RFC 5737 / 3849) — the same convention `nextClientIp()` uses in the
 * e2e helpers. They read as ordinary addresses on screen, but no real machine ever holds one:
 * a corpus that will be filmed must not show an IP anyone could mistake for a real visitor's.
 */
export const CLIENT_IPS = [
  "203.0.113.7",
  "203.0.113.42",
  "198.51.100.23",
  "198.51.100.180",
  "::ffff:203.0.113.99",
  "192.0.2.61",
];

export const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0",
  "curl/8.7.1",
];

export const USER_IDS = ["u-1", "u-1", "u-1", "u-2", null, null, null, null];

export type ErrorTemplate = {
  service: string;
  logger: string;
  type: string | null;
  message: string;
  stack: string | null;
  levelName: "error" | "fatal";
  status: "unresolved" | "resolved" | "ignored";
  regression: boolean;
  /** Days ago the error first ever appeared — issues outlive the 7-day log corpus. */
  firstSeenDaysAgo: number;
  /** Occurrence clusters inside the 7-day window: [daysAgo (fractional), count]. */
  clusters: Array<[number, number]>;
};

export const ERROR_TEMPLATES: ErrorTemplate[] = [
  {
    service: "atlas-api",
    logger: "atlas",
    type: "TypeError",
    message: "Cannot read properties of undefined (reading 'siret')",
    stack: [
      "TypeError: Cannot read properties of undefined (reading 'siret')",
      "    at ExpenseMapper.toRow (/opt/apps/atlas/nest-api/dist/expenses/expense-mapper.js:87:31)",
      "    at Array.map (<anonymous>)",
      "    at ExpensesService.list (/opt/apps/atlas/nest-api/dist/expenses/expenses.service.js:54:28)",
      "    at ExpensesController.list (/opt/apps/atlas/nest-api/dist/expenses/expenses.controller.js:40:39)",
      "    at /opt/apps/atlas/nest-api/node_modules/@nestjs/core/router/router-execution-context.js:38:29",
    ].join("\n"),
    levelName: "error",
    status: "unresolved",
    regression: false,
    firstSeenDaysAgo: 11,
    clusters: [
      [6.6, 3],
      [5.2, 2],
      [3.4, 4],
      [1.8, 3],
      [0.6, 2],
      [0.05, 1],
    ],
  },
  {
    service: "beacon-api",
    logger: "weathr",
    type: "FetchError",
    message: "forecast upstream request timed out after 8000 ms",
    stack: [
      "FetchError: forecast upstream request timed out after 8000 ms",
      "    at ForecastClient.fetchCity (/opt/apps/beacon/nest-api/dist/forecast/forecast-client.js:61:19)",
      "    at ForecastService.refresh (/opt/apps/beacon/nest-api/dist/forecast/forecast.service.js:112:24)",
      "    at ForecastController.byCity (/opt/apps/beacon/nest-api/dist/forecast/forecast.controller.js:33:27)",
      "    at /opt/apps/beacon/nest-api/node_modules/@nestjs/core/router/router-proxy.js:9:17",
    ].join("\n"),
    levelName: "error",
    status: "unresolved",
    regression: false,
    firstSeenDaysAgo: 9,
    clusters: [
      [4.05, 26],
      [4.02, 18],
      [2.5, 2],
      [0.9, 2],
      [0.13, 1],
    ],
  },
  {
    service: "beacon-api",
    logger: "weathr",
    type: "Error",
    message: "connect ECONNREFUSED 127.0.0.1:6379",
    stack: null,
    levelName: "fatal",
    status: "unresolved",
    regression: false,
    firstSeenDaysAgo: 0.14,
    clusters: [[0.125, 6]],
  },
  {
    service: "cinder-api",
    logger: "cinder",
    type: "PrismaClientKnownRequestError",
    message: "Unique constraint failed on the constraint: `issue_owner_identifier_key`",
    stack: [
      "PrismaClientKnownRequestError: Unique constraint failed on the constraint: `issue_owner_identifier_key`",
      "    at Proxy.create (/opt/apps/cinder/nest-api/node_modules/@prisma/client/runtime/library.js:112:1363)",
      "    at IssuesService.create (/opt/apps/cinder/nest-api/dist/issues/issues.service.js:141:26)",
      "    at IssuesController.create (/opt/apps/cinder/nest-api/dist/issues/issues.controller.js:52:33)",
    ].join("\n"),
    levelName: "error",
    status: "resolved",
    regression: false,
    firstSeenDaysAgo: 13,
    clusters: [
      [6.1, 2],
      [4.8, 1],
    ],
  },
  {
    service: "keystone-api",
    logger: "keystone",
    type: "RangeError",
    message: "byte offset ran past the rotated file",
    stack: [
      "RangeError: byte offset ran past the rotated file",
      "    at Tailer.readSlice (/opt/apps/keystone/nest-api/dist/src/ingest/tailer.js:171:15)",
      "    at Tailer.poll (/opt/apps/keystone/nest-api/dist/src/ingest/tailer.js:129:22)",
      "    at IngestService.tick (/opt/apps/keystone/nest-api/dist/src/ingest/ingest.service.js:63:20)",
    ].join("\n"),
    levelName: "error",
    status: "ignored",
    regression: false,
    firstSeenDaysAgo: 12,
    clusters: [
      [5.5, 1],
      [2.9, 1],
      [1.2, 1],
    ],
  },
  {
    service: "gale-api",
    logger: "chat",
    type: "WebSocketError",
    message: "peer closed mid-frame",
    stack: [
      "WebSocketError: peer closed mid-frame",
      "    at Session.onFrame (/opt/apps/gale/backend/dist/session.js:203:11)",
      "    at WebSocket.emit (node:events:519:28)",
      "    at Receiver.receiverOnMessage (/opt/apps/gale/backend/node_modules/ws/lib/websocket.js:1220:20)",
    ].join("\n"),
    levelName: "error",
    status: "unresolved",
    regression: true,
    firstSeenDaysAgo: 19,
    clusters: [
      [2.2, 2],
      [1.1, 3],
      [0.35, 2],
    ],
  },
  {
    service: "dovetail-api",
    logger: "dovetail",
    type: "HttpException",
    message: "deploy report rejected: unknown service 'nginx'",
    stack: [
      "HttpException: deploy report rejected: unknown service 'nginx'",
      "    at DeployReportsService.accept (/opt/apps/dovetail/nest-api/dist/deploys/deploy-reports.service.js:77:15)",
      "    at DeployReportsController.report (/opt/apps/dovetail/nest-api/dist/deploys/deploy-reports.controller.js:29:41)",
    ].join("\n"),
    levelName: "error",
    status: "unresolved",
    regression: false,
    firstSeenDaysAgo: 6.8,
    clusters: [
      [6.8, 1],
      [3.9, 1],
      [0.8, 1],
    ],
  },
  /* ── the rest of the fleet: every service has at least one recurring error this week ──────── */
  {
    service: "keystone-api",
    logger: "keystone",
    type: "PrismaClientKnownRequestError",
    message: "Can't reach database server at `127.0.0.1:3306`",
    stack: [
      "PrismaClientKnownRequestError: Can't reach database server at `127.0.0.1:3306`",
      "    at Proxy.$queryRaw (/opt/apps/keystone/nest-api/node_modules/@prisma/client/runtime/library.js:112:2010)",
      "    at HistogramService.buckets (/opt/apps/keystone/nest-api/dist/src/logs/histogram.service.js:71:33)",
      "    at LogsController.histogram (/opt/apps/keystone/nest-api/dist/src/logs/logs.controller.js:88:40)",
    ].join("\n"),
    levelName: "error",
    status: "unresolved",
    regression: true,
    firstSeenDaysAgo: 14,
    clusters: [
      [5.9, 4],
      [2.4, 2],
      [0.3, 3],
    ],
  },
  {
    service: "keystone-front",
    logger: "next",
    type: "TypeError",
    message: "Cannot read properties of null (reading 'bucketMs')",
    stack: [
      "TypeError: Cannot read properties of null (reading 'bucketMs')",
      "    at Histogram (/opt/apps/keystone/front/.next/server/app/(app)/logs/page.js:1:41833)",
      "    at renderWithHooks (/opt/apps/keystone/front/node_modules/react-dom/cjs/react-dom-server.node.production.js:5124:16)",
    ].join("\n"),
    levelName: "error",
    status: "unresolved",
    regression: false,
    firstSeenDaysAgo: 4.2,
    clusters: [
      [4.2, 2],
      [1.6, 3],
      [0.5, 1],
    ],
  },
  {
    service: "atlas-front",
    logger: "next",
    type: "TypeError",
    message: "Hydration failed: cannot read 'amount' of undefined",
    stack: [
      "TypeError: Hydration failed: cannot read 'amount' of undefined",
      "    at ExpenseRow (/opt/apps/atlas/front/.next/server/app/expenses/page.js:1:22981)",
      "    at renderWithHooks (/opt/apps/atlas/front/node_modules/react-dom/cjs/react-dom-server.node.production.js:5124:16)",
    ].join("\n"),
    levelName: "error",
    status: "unresolved",
    regression: false,
    firstSeenDaysAgo: 8,
    clusters: [
      [6.3, 2],
      [3.1, 4],
      [0.9, 2],
    ],
  },
  {
    service: "cinder-front",
    logger: "next",
    type: "ChunkLoadError",
    message: "Loading chunk 483 failed (timeout: /_next/static/chunks/483-9c1f2.js)",
    stack: [
      "ChunkLoadError: Loading chunk 483 failed (timeout: /_next/static/chunks/483-9c1f2.js)",
      "    at __webpack_require__.f.j (/opt/apps/cinder/front/.next/static/chunks/webpack-8a1e.js:1:4211)",
      "    at BoardPage (/opt/apps/cinder/front/.next/server/app/board/page.js:1:18102)",
    ].join("\n"),
    levelName: "error",
    status: "resolved",
    regression: false,
    firstSeenDaysAgo: 5.5,
    clusters: [
      [5.5, 3],
      [4.9, 1],
    ],
  },
  {
    service: "dovetail-front",
    logger: "next",
    type: "TypeError",
    message: "Cannot read properties of undefined (reading 'lastRunAt')",
    stack: [
      "TypeError: Cannot read properties of undefined (reading 'lastRunAt')",
      "    at CronRow (/opt/apps/dovetail/front/.next/server/app/cron/page.js:1:15644)",
      "    at renderWithHooks (/opt/apps/dovetail/front/node_modules/react-dom/cjs/react-dom-server.node.production.js:5124:16)",
    ].join("\n"),
    levelName: "error",
    status: "unresolved",
    regression: false,
    firstSeenDaysAgo: 2.7,
    clusters: [
      [2.7, 2],
      [1.3, 2],
    ],
  },
  {
    service: "beacon-front",
    logger: "next",
    type: "RangeError",
    message: "Invalid time value",
    stack: [
      "RangeError: Invalid time value",
      "    at Date.toISOString (<anonymous>)",
      "    at DeclareForm (/opt/apps/beacon/front/.next/server/app/declare/page.js:1:9020)",
    ].join("\n"),
    levelName: "error",
    status: "unresolved",
    regression: false,
    firstSeenDaysAgo: 6.1,
    clusters: [
      [6.1, 1],
      [3.8, 2],
      [0.7, 2],
    ],
  },
  {
    service: "ember-front",
    logger: "next",
    type: "AbortError",
    message: "The operation was aborted: listing /var/log cancelled by navigation",
    stack: [
      "AbortError: The operation was aborted: listing /var/log cancelled by navigation",
      "    at abortSignal (node:internal/abort_controller:389:5)",
      "    at usePane (/opt/apps/ember/front/.next/server/app/browse/page.js:1:27310)",
    ].join("\n"),
    levelName: "error",
    status: "ignored",
    regression: false,
    firstSeenDaysAgo: 9,
    clusters: [
      [6.7, 3],
      [2.2, 4],
      [0.4, 2],
    ],
  },
  {
    service: "fathom-front",
    logger: "next",
    type: "TypeError",
    message: "Failed to fetch favicon: NetworkError when attempting to fetch resource",
    stack: [
      "TypeError: Failed to fetch favicon: NetworkError when attempting to fetch resource",
      "    at Favicon (/opt/apps/fathom/front/.next/server/app/page.js:1:11207)",
      "    at renderWithHooks (/opt/apps/fathom/front/node_modules/react-dom/cjs/react-dom-server.node.production.js:5124:16)",
    ].join("\n"),
    levelName: "error",
    status: "unresolved",
    regression: false,
    firstSeenDaysAgo: 3.4,
    clusters: [
      [3.4, 2],
      [1.9, 1],
      [0.2, 1],
    ],
  },
  {
    service: "gale-front",
    logger: "next",
    type: "WebSocketError",
    message: "socket closed before handshake completed",
    stack: [
      "WebSocketError: socket closed before handshake completed",
      "    at Room.connect (/opt/apps/gale/front/.next/static/chunks/room-4c2e.js:1:8801)",
    ].join("\n"),
    levelName: "error",
    status: "unresolved",
    regression: false,
    firstSeenDaysAgo: 11,
    clusters: [
      [5.2, 2],
      [2.6, 3],
    ],
  },
  {
    service: "fathom-api",
    logger: "fathom",
    type: "Error",
    message: "connect ETIMEDOUT 198.51.100.12:443",
    stack: [
      "Error: connect ETIMEDOUT 198.51.100.12:443",
      "    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1615:16)",
      "    at FaviconFetcher.fetch (/opt/apps/fathom/server/dist/favicon/favicon-fetcher.js:44:19)",
    ].join("\n"),
    levelName: "error",
    status: "unresolved",
    regression: false,
    firstSeenDaysAgo: 7.5,
    clusters: [
      [4.4, 3],
      [2.8, 2],
      [0.6, 2],
    ],
  },
  {
    service: "ember-api",
    logger: "ember",
    type: "Error",
    message: "EACCES: permission denied, scandir '/opt/apps/atlas/nest-api/.env'",
    stack: [
      "Error: EACCES: permission denied, scandir '/opt/apps/atlas/nest-api/.env'",
      "    at LocalDriver.list (/opt/apps/ember/nest-api/dist/hosts/local-driver.js:58:22)",
      "    at ListingService.list (/opt/apps/ember/nest-api/dist/listing/listing.service.js:33:28)",
    ].join("\n"),
    levelName: "error",
    status: "resolved",
    regression: false,
    firstSeenDaysAgo: 6.4,
    clusters: [
      [6.4, 2],
      [5.1, 1],
    ],
  },
  {
    service: "harbor-api",
    logger: "harbor",
    type: "ValidationError",
    message: "score must be an integer between 0 and 999999",
    stack: [
      "ValidationError: score must be an integer between 0 and 999999",
      "    at ScoresController.submit (/opt/apps/harbor/api/dist/scores/scores.controller.js:21:15)",
    ].join("\n"),
    levelName: "error",
    status: "ignored",
    regression: false,
    firstSeenDaysAgo: 20,
    clusters: [
      [4.7, 2],
      [1.5, 3],
    ],
  },
  {
    service: "ivory-api",
    logger: "ivory",
    type: "RangeError",
    message: "Maximum call stack size exceeded",
    stack: [
      "RangeError: Maximum call stack size exceeded",
      "    at step (/opt/apps/ivory/api/dist/life/step.js:14:20)",
      "    at step (/opt/apps/ivory/api/dist/life/step.js:22:12)",
    ].join("\n"),
    levelName: "fatal",
    status: "unresolved",
    regression: false,
    firstSeenDaysAgo: 1.1,
    clusters: [[1.1, 2]],
  },
  {
    service: "juniper",
    logger: "juniper",
    type: "Error",
    message: "listen EADDRINUSE: address already in use :::7110",
    stack: [
      "Error: listen EADDRINUSE: address already in use :::7110",
      "    at Server.setupListenHandle [as _listen2] (node:net:1908:16)",
      "    at listenInCluster (node:net:1965:12)",
    ].join("\n"),
    levelName: "fatal",
    status: "unresolved",
    regression: false,
    firstSeenDaysAgo: 6.9,
    clusters: [[6.9, 1]],
  },
  /* ── a second, still-open error for the services whose first one is already closed ─────────── */
  {
    service: "cinder-api",
    logger: "cinder",
    type: "TypeError",
    message: "Cannot read properties of undefined (reading 'issueCounter')",
    stack: [
      "TypeError: Cannot read properties of undefined (reading 'issueCounter')",
      "    at ProjectsService.nextIdentifier (/opt/apps/cinder/nest-api/dist/projects/projects.service.js:88:31)",
      "    at IssuesService.create (/opt/apps/cinder/nest-api/dist/issues/issues.service.js:136:44)",
    ].join("\n"),
    levelName: "error",
    status: "unresolved",
    regression: false,
    firstSeenDaysAgo: 2.9,
    clusters: [
      [2.9, 2],
      [0.8, 2],
    ],
  },
  {
    service: "cinder-front",
    logger: "next",
    type: "TypeError",
    message: "Cannot read properties of null (reading 'workflowState')",
    stack: [
      "TypeError: Cannot read properties of null (reading 'workflowState')",
      "    at IssueCard (/opt/apps/cinder/front/.next/server/app/board/page.js:1:23310)",
      "    at renderWithHooks (/opt/apps/cinder/front/node_modules/react-dom/cjs/react-dom-server.node.production.js:5124:16)",
    ].join("\n"),
    levelName: "error",
    status: "unresolved",
    regression: false,
    firstSeenDaysAgo: 3.6,
    clusters: [
      [3.6, 1],
      [1.4, 3],
    ],
  },
  {
    service: "ember-api",
    logger: "ember",
    type: "Error",
    message: "ENOSPC: no space left on device, write '/tmp/ember-scan-8f2c.json'",
    stack: [
      "Error: ENOSPC: no space left on device, write '/tmp/ember-scan-8f2c.json'",
      "    at DiskScanService.persist (/opt/apps/ember/nest-api/dist/scans/disk-scan.service.js:142:17)",
      "    at DiskScanService.run (/opt/apps/ember/nest-api/dist/scans/disk-scan.service.js:97:22)",
    ].join("\n"),
    levelName: "fatal",
    status: "unresolved",
    regression: false,
    firstSeenDaysAgo: 1.7,
    clusters: [
      [1.7, 2],
      [0.35, 1],
    ],
  },
  {
    service: "ember-front",
    logger: "next",
    type: "TypeError",
    message: "Cannot read properties of undefined (reading 'mtimeMs')",
    stack: [
      "TypeError: Cannot read properties of undefined (reading 'mtimeMs')",
      "    at Row (/opt/apps/ember/front/.next/server/app/browse/page.js:1:31166)",
      "    at renderWithHooks (/opt/apps/ember/front/node_modules/react-dom/cjs/react-dom-server.node.production.js:5124:16)",
    ].join("\n"),
    levelName: "error",
    status: "unresolved",
    regression: false,
    firstSeenDaysAgo: 4.1,
    clusters: [
      [4.1, 2],
      [2.0, 1],
      [0.6, 2],
    ],
  },
  {
    service: "harbor-api",
    logger: "harbor",
    type: "PrismaClientKnownRequestError",
    message: "Timed out fetching a new connection from the connection pool",
    stack: [
      "PrismaClientKnownRequestError: Timed out fetching a new connection from the connection pool",
      "    at Proxy.findMany (/opt/apps/harbor/api/node_modules/@prisma/client/runtime/library.js:112:1363)",
      "    at ScoresService.top (/opt/apps/harbor/api/dist/scores/scores.service.js:27:30)",
    ].join("\n"),
    levelName: "error",
    status: "unresolved",
    regression: true,
    firstSeenDaysAgo: 16,
    clusters: [
      [5.3, 3],
      [1.0, 2],
    ],
  },
];
