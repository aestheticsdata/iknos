import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { culpritOf, fingerprintOf, normaliseFrames } from "@issues/fingerprint";
import { labelsHash } from "@src/scrape/labels-hash";
import {
  CLIENT_IPS,
  DAY_WEIGHT,
  ERROR_TEMPLATES,
  HOSTNAME,
  HOUR_WEIGHT,
  PROFILES,
  USER_AGENTS,
  USER_IDS,
} from "./profiles";

import type { ErrorTemplate, Profile, Route } from "./profiles";

/**
 * Writes the mock corpus under `mock/` (IKN-61). Run by `pnpm mock:author`, by a person, once —
 * the output is committed and the files are then the source of truth. `pnpm mock` never calls
 * this; loading must not regenerate.
 *
 * **Deterministic on purpose.** Everything is derived from a seeded PRNG and a fixed reference
 * instant — never the clock. Re-running this file unchanged produces a byte-identical corpus and
 * an empty `git diff` on `mock/`, which is the test that it still tells the truth.
 *
 * The shape constraints the corpus must satisfy come from the read side, not from taste, and the
 * hashes come from the same functions production uses: `labelsHash` for metric series identity,
 * `fingerprintOf` for issues. A corpus hashed by a second implementation would split every series
 * the day either function moved.
 */

/**
 * The reference instant: the newest timestamp in the corpus. `load.ts` measures the corpus's own
 * maximum, so this constant never travels — it only anchors generation. A generator that read
 * `Date.now()` would diff on every run and make the corpus impossible to re-read.
 */
const REFERENCE_MS = Date.UTC(2026, 8, 1, 12, 0, 0, 0);

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const OUT_DIR = __dirname;

/* ── deterministic randomness ─────────────────────────────────────────────────────────────────── */

/** mulberry32 — small, seedable, and good enough for shaping traffic. Seeded with the ticket. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(61);
const chance = (p: number): boolean => rand() < p;
const int = (lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];

/** Box–Muller over the seeded PRNG — the long tail that makes a p95 mean something. */
function gauss(): number {
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const lognormal = (median: number, sigma: number): number => median * Math.exp(sigma * gauss());

/** 32 lowercase hex characters — the shape `trace_id CHAR(32)` and the trace route both accept. */
function traceId(): string {
  let out = "";
  for (let i = 0; i < 32; i++) out += "0123456789abcdef"[Math.floor(rand() * 16)];
  return out;
}

const iso = (ms: number): string => new Date(ms).toISOString();

/* ── the week's shape ─────────────────────────────────────────────────────────────────────────── */

/**
 * The 7-day window as 168 hour slots ending at the reference, each weighted by its day and its
 * *clock* hour — the trough must land at night on the histogram's axis, not at some offset of the
 * reference instant.
 */
const HOUR_SLOTS: Array<{ start: number; weight: number }> = (() => {
  const slots: Array<{ start: number; weight: number }> = [];
  for (let i = 0; i < 168; i++) {
    const start = REFERENCE_MS - (168 - i) * HOUR;
    const day = Math.floor(i / 24);
    const clockHour = new Date(start).getUTCHours();
    slots.push({ start, weight: DAY_WEIGHT[day] * HOUR_WEIGHT[clockHour] });
  }
  return slots;
})();

const SLOT_TOTAL = HOUR_SLOTS.reduce((a, s) => a + s.weight, 0);

/** A timestamp inside the 7-day window, day- and hour-weighted. */
function weightedInstant(): number {
  let roll = rand() * SLOT_TOTAL;
  for (const slot of HOUR_SLOTS) {
    roll -= slot.weight;
    if (roll <= 0) return Math.min(REFERENCE_MS - 1_000, slot.start + Math.floor(rand() * HOUR));
  }
  return REFERENCE_MS - 1_000;
}

/* ── log lines ────────────────────────────────────────────────────────────────────────────────── */

type Line = { ts: number; text: string };

/** One ECS NDJSON line, keys in a stable order so the corpus diffs cleanly. */
function ecs(ts: number, level: string, logger: string, message: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    "@timestamp": iso(ts),
    "log.level": level,
    "log.logger": logger,
    message,
    "host.hostname": HOSTNAME,
    ...extra,
  });
}

function httpLine(profile: Profile, ts: number, overrides: Partial<{ status: number; factor: number }> = {}): Line {
  const route = weightedRoute(profile.routes);
  const status =
    overrides.status ?? (chance(0.955) ? okStatus(route.method) : chance(0.75) ? pick([301, 400, 404]) : 500);
  const durationMs = Math.max(1, Math.round(lognormal(route.median, 0.7) * (overrides.factor ?? 1)));
  const level = status >= 500 ? "error" : status >= 400 ? (chance(0.5) ? "warn" : "info") : "info";
  const extra: Record<string, unknown> = {
    "http.request.method": route.method,
    "url.path": route.route,
    "http.response.status_code": status,
    "event.duration": durationMs * 1_000_000,
    "client.ip": pick(CLIENT_IPS),
    "user_agent.original": pick(USER_AGENTS),
    req_id: `req-${int(100000, 999999)}`,
  };
  const userId = pick(USER_IDS);
  if (userId !== null) extra["user.id"] = userId;
  const message = `${route.method} ${route.route} ${status} in ${durationMs} ms`;
  return { ts, text: ecs(ts, level, profile.logger, message, extra) };
}

function weightedRoute(routes: Route[]): Route {
  const total = routes.reduce((a, r) => a + r.w, 0);
  let roll = rand() * total;
  for (const route of routes) {
    roll -= route.w;
    if (roll <= 0) return route;
  }
  return routes[routes.length - 1];
}

const okStatus = (method: string): number => (method === "POST" ? (chance(0.7) ? 201 : 200) : 200);

function eventLine(profile: Profile, ts: number): Line {
  const level = chance(profile.debug / (profile.debug + 0.2)) ? "debug" : "info";
  const message = pick(profile.events).replace("{n}", String(int(3, 4200)));
  return { ts, text: ecs(ts, level, profile.logger, message, { pid: int(200, 32000) }) };
}

/* ── recurring errors — the raw material of IKN-9 ─────────────────────────────────────────────── */

function errorLine(template: ErrorTemplate, ts: number, trace: string | null): Line {
  const extra: Record<string, unknown> = {
    "error.message": template.message,
    req_id: `req-${int(100000, 999999)}`,
  };
  if (template.type !== null) extra["error.type"] = template.type;
  if (template.stack !== null) extra["error.stack_trace"] = template.stack;
  if (trace !== null) extra["trace.id"] = trace;
  const message = template.type !== null ? `${template.type}: ${template.message}` : template.message;
  return { ts, text: ecs(ts, template.levelName, template.logger, message, extra) };
}

/* ── generation ───────────────────────────────────────────────────────────────────────────────── */

const linesByService = new Map<string, Line[]>();
for (const profile of PROFILES) linesByService.set(profile.name, []);

function push(service: string, line: Line): void {
  const lines = linesByService.get(service);
  if (lines === undefined) throw new Error(`unknown service in corpus: ${service}`);
  lines.push(line);
}

const TOTAL_LINES = 13_600;

for (const profile of PROFILES) {
  const target = Math.round(TOTAL_LINES * profile.weight);
  for (let i = 0; i < target; i++) {
    const ts = weightedInstant();
    const line = chance(0.78) ? httpLine(profile, ts) : eventLine(profile, ts);
    push(profile.name, line);
  }
}

/* Traces: a front request fanning into its API, 4–12 lines over 2–3 services (IKN-12's cascade). */

const TRACE_PAIRS: Array<[string, string]> = [
  ["pfa-front", "pfa-nest-api"],
  ["spira-front", "spira-nest-api"],
  ["iknos-front", "iknos-api"],
  ["worldweathr-front", "worldweathr-api"],
  ["zeus-front", "zeus-nest-api"],
  ["bkmk-front", "bkmk-server"],
  ["1991chat-front", "1991chat-backend"],
  ["trekker-front", "trekker-api"],
];

const profileOf = (name: string): Profile => {
  const profile = PROFILES.find((p) => p.name === name);
  if (profile === undefined) throw new Error(`no profile for ${name}`);
  return profile;
};

for (let i = 0; i < 72; i++) {
  const [frontName, apiName] = pick(TRACE_PAIRS);
  const front = profileOf(frontName);
  const api = profileOf(apiName);
  const id = traceId();
  const start = weightedInstant();
  const apiRoute = weightedRoute(api.routes);
  const spanCount = int(2, 6);
  const threeServices = apiName === "zeus-nest-api" && chance(0.6);

  let cursor = start + int(2, 9);
  let innerTotal = 0;
  for (let s = 0; s < spanCount; s++) {
    const step = Math.max(1, Math.round(lognormal(apiRoute.median / spanCount, 0.5)));
    const stepText = pick([
      `query ${s + 1}/${spanCount} on ${apiRoute.route}`,
      `resolved dependencies for ${apiRoute.route}`,
      `serialized response chunk ${s + 1}`,
    ]);
    push(api.name, {
      ts: cursor,
      text: ecs(cursor, chance(0.3) ? "debug" : "info", api.logger, stepText, {
        "trace.id": id,
        "event.duration": step * 1_000_000,
        req_id: `req-${int(100000, 999999)}`,
      }),
    });
    cursor += step + int(1, 4);
    innerTotal += step;
  }

  if (threeServices) {
    const hop = int(4, 18);
    push("iknos-api", {
      ts: cursor,
      text: ecs(cursor, "info", "iknos", "GET /api/collector/status 200 in 4 ms", {
        "trace.id": id,
        "http.request.method": "GET",
        "url.path": "/api/collector/status",
        "http.response.status_code": 200,
        "event.duration": 4 * 1_000_000,
        "client.ip": "127.0.0.1",
      }),
    });
    cursor += hop;
    innerTotal += hop;
  }

  const apiStatus = chance(0.93) ? okStatus(apiRoute.method) : 500;
  const apiDuration = innerTotal + int(3, 25);
  push(api.name, {
    ts: cursor,
    text: ecs(
      cursor,
      apiStatus >= 500 ? "error" : "info",
      api.logger,
      `${apiRoute.method} ${apiRoute.route} ${apiStatus} in ${apiDuration} ms`,
      {
        "trace.id": id,
        "http.request.method": apiRoute.method,
        "url.path": apiRoute.route,
        "http.response.status_code": apiStatus,
        "event.duration": apiDuration * 1_000_000,
        "client.ip": pick(CLIENT_IPS),
        "user_agent.original": pick(USER_AGENTS),
      },
    ),
  });

  const frontRoute = weightedRoute(front.routes);
  const frontDuration = apiDuration + int(20, 90);
  const frontTs = cursor + int(2, 8);
  push(front.name, {
    ts: frontTs,
    text: ecs(
      frontTs,
      "info",
      front.logger,
      `${frontRoute.method} ${frontRoute.route} ${apiStatus >= 500 ? 500 : 200} in ${frontDuration} ms`,
      {
        "trace.id": id,
        "http.request.method": frontRoute.method,
        "url.path": frontRoute.route,
        "http.response.status_code": apiStatus >= 500 ? 500 : 200,
        "event.duration": frontDuration * 1_000_000,
        "client.ip": pick(CLIENT_IPS),
        "user_agent.original": pick(USER_AGENTS),
      },
    ),
  });
}

/* Recurring errors, on their clusters' schedule. */

const occurrencesByTemplate = new Map<ErrorTemplate, number[]>();
for (const template of ERROR_TEMPLATES) {
  const occurrences: number[] = [];
  for (const [daysAgo, count] of template.clusters) {
    const clusterStart = REFERENCE_MS - daysAgo * DAY;
    for (let i = 0; i < count; i++) {
      const ts = clusterStart + Math.floor(rand() * 20 * MINUTE);
      occurrences.push(ts);
      push(template.service, errorLine(template, ts, chance(0.4) ? traceId() : null));
    }
  }
  occurrences.sort((a, b) => a - b);
  occurrencesByTemplate.set(template, occurrences);
}

/* ── the three incidents ──────────────────────────────────────────────────────────────────────── */

/** I1 — worldweathr-api, day −4: a 25-minute 5xx burst (the FetchError clusters above sit in it). */
const I1_START = REFERENCE_MS - 4.05 * DAY;
const I1_END = I1_START + 25 * MINUTE;
for (let ts = I1_START; ts < I1_END; ts += int(8, 20) * 1000) {
  push("worldweathr-api", httpLine(profileOf("worldweathr-api"), ts, { status: 500, factor: 4 }));
}

/** I2 — pfa-nest-api, −26 h: a 40-minute latency spike, warn lines and a fat duration tail. */
const I2_START = REFERENCE_MS - 26 * HOUR;
const I2_END = I2_START + 40 * MINUTE;
for (let ts = I2_START; ts < I2_END; ts += int(10, 30) * 1000) {
  if (chance(0.3)) {
    push("pfa-nest-api", {
      ts,
      text: ecs(ts, "warn", "pfa", `slow query: expenses list took ${int(1400, 5200)} ms`, {
        pool_waiting: int(1, 4),
      }),
    });
  } else {
    push("pfa-nest-api", httpLine(profileOf("pfa-nest-api"), ts, { factor: 9 }));
  }
}

/** I3 — worldweathr-api, −3 h: Redis gone for 20 minutes; the probe fails, then a restart. */
const I3_START = REFERENCE_MS - 3 * HOUR;
const I3_END = I3_START + 20 * MINUTE;
for (let ts = I3_START; ts < I3_END; ts += int(20, 45) * 1000) {
  // No error.* keys here on purpose: the groupable form of this failure is the fatal template
  // above, and these companion lines must not inflate its occurrence count.
  push("worldweathr-api", {
    ts,
    text: ecs(ts, "error", "weathr", "session store unreachable, request refused", {
      refused_ip: "127.0.0.1:6379",
    }),
  });
}

/* After I3: a restart — pm2/Nest boot banners, the plain-text grade the parser stores as-is. */
const bootAt = I3_END + 40 * 1000;
const BOOT_LINES = [
  "[Nest] 4021  - 09/01/2026, 9:20:41 AM     LOG [NestFactory] Starting Nest application...",
  "[Nest] 4021  - 09/01/2026, 9:20:41 AM     LOG [InstanceLoader] AppModule dependencies initialized",
  "[Nest] 4021  - 09/01/2026, 9:20:42 AM     LOG [NestApplication] Nest application successfully started",
];
BOOT_LINES.forEach((text, i) => {
  push("worldweathr-api", { ts: bootAt + i * 350, text });
});

/* One line that was trying to be JSON and lost — the parser's `degraded` path, on purpose. */
push("trekker-api", {
  ts: REFERENCE_MS - 2.3 * DAY,
  text: '{"@timestamp":"2026-08-30T05:12:44.102Z","log.level":"info","message":"transfer finished","bytes":48211',
});

/* A couple of alias level names — LEVELS maps them, and the corpus should prove it. */
push("zeus-nest-api", {
  ts: REFERENCE_MS - 1.4 * DAY,
  text: ecs(REFERENCE_MS - 1.4 * DAY, "warning", "zeus", "offsite push took 41 s, twice the usual", {}),
});
push("iknos-api", {
  ts: REFERENCE_MS - 3.1 * DAY,
  text: ecs(REFERENCE_MS - 3.1 * DAY, "critical", "iknos", "queue high-water mark: 18452 of 20000 records", {}),
});

/* The newest line of the corpus sits exactly on the reference instant. */
push("iknos-api", {
  ts: REFERENCE_MS,
  text: ecs(REFERENCE_MS, "info", "iknos", "GET /api/services 200 in 19 ms", {
    "http.request.method": "GET",
    "url.path": "/api/services",
    "http.response.status_code": 200,
    "event.duration": 19_000_000,
    "client.ip": pick(CLIENT_IPS),
    "user_agent.original": pick(USER_AGENTS),
  }),
});

/* ── metrics — the whole fleet, because the demo's world is a fully instrumented one ──────────── */

type SeriesPoint = [string, number];
type Series = {
  service: string;
  name: string;
  labels: Record<string, string> | null;
  labelsHash: string;
  points: SeriesPoint[];
};
type RollupRow = [string, number, number, number, number, number];
type RollupSeries = Omit<Series, "points"> & { hours: RollupRow[] };

/**
 * Every service gets metrics — the mockup's world is a fleet where everything is instrumented,
 * and a demo that only lights two tiles out of nineteen reads as a half-finished product. The
 * two services ks-b actually instruments keep the full-density grid; the rest get a lighter one
 * and fewer series — still enough for every chart at every range. `hiwaysim` alone gets none,
 * deliberately: it is stopped in pm2, and one service demonstrating the honest empty-tiles state
 * is coverage, not a gap.
 */
const FLAGSHIP = new Set(["pfa-nest-api", "worldweathr-api"]);

/**
 * The raw sample grid, dense where the narrow ranges look: the 15 m view buckets at 15 s and the
 * 1 h view at 60 s, and a chart bucket with no reading draws a gap.
 */
function sampleGrid(flagship: boolean): number[] {
  const grid: number[] = [];
  const farStep = flagship ? 15 * MINUTE : 30 * MINUTE;
  const midStep = flagship ? 5 * MINUTE : 10 * MINUTE;
  for (let t = REFERENCE_MS - 72 * HOUR; t < REFERENCE_MS - 27 * HOUR; t += farStep) grid.push(t);
  for (let t = REFERENCE_MS - 27 * HOUR; t < REFERENCE_MS - 2 * HOUR; t += midStep) grid.push(t);
  for (let t = REFERENCE_MS - 2 * HOUR; t < REFERENCE_MS - 20 * MINUTE; t += MINUTE) grid.push(t);
  for (let t = REFERENCE_MS - 20 * MINUTE; t <= REFERENCE_MS; t += 15 * 1000) grid.push(t);
  return grid;
}

/** Requests per minute for one tag of one service — the traffic curve, plus each incident. */
function rpm(profile: Profile, tag: string, t: number): number {
  const curve = HOUR_WEIGHT[new Date(t).getUTCHours()];
  const base = 3 + profile.weight * 230;
  if (tag === "2xx") return base * curve;
  if (tag === "4xx") return base * 0.035 * curve;
  if (tag === "5xx") {
    if (profile.name === "worldweathr-api" && t >= I1_START && t < I1_END) return 24;
    if (profile.name === "worldweathr-api" && t >= I3_START && t < I3_END) return 11;
    return base * 0.0025;
  }
  return 0;
}

/** Share of requests answered under each latency bound — per character, and pfa's I2 shifts it. */
function leShares(profile: Profile, t: number): Record<string, number> {
  if (profile.name === "pfa-nest-api" && t >= I2_START && t < I2_END) {
    return { "0.025": 0.04, "0.1": 0.18, "0.5": 0.55, "1": 0.78, "+Inf": 1 };
  }
  // Fronts render pages, APIs answer queries — their latency distributions must not look alike.
  if (profile.routes[0].median >= 100) return { "0.025": 0.05, "0.1": 0.4, "0.5": 0.9, "1": 0.985, "+Inf": 1 };
  return { "0.025": 0.42, "0.1": 0.8, "0.5": 0.97, "1": 0.995, "+Inf": 1 };
}

const LE_BOUNDS = ["0.025", "0.1", "0.5", "1", "+Inf"];

const metricSeries: Series[] = [];
const rollupSeries: RollupSeries[] = [];

for (const profile of PROFILES) {
  if (profile.name === "hiwaysim") continue;
  const service = profile.name;
  const flagship = FLAGSHIP.has(service);
  const isFront = service.endsWith("-front");
  const grid = sampleGrid(flagship);
  const durationRoute = profile.routes[0].route;

  /** One cumulative walk from a week back to the reference — rollup hours first, raw grid after. */
  const walk = (
    ratePerMin: (t: number) => number,
    startValue: number,
  ): { hours: Map<number, number>; samples: SeriesPoint[] } => {
    const hours = new Map<number, number>();
    let value = startValue;
    const weekStart = REFERENCE_MS - 7 * DAY - 6 * HOUR;
    for (let hourStart = weekStart; hourStart < REFERENCE_MS - 72 * HOUR; hourStart += HOUR) {
      value += ratePerMin(hourStart + 30 * MINUTE) * 60;
      hours.set(hourStart, Math.round(value));
    }
    const samples: SeriesPoint[] = [];
    let prev = REFERENCE_MS - 72 * HOUR;
    for (const t of grid) {
      value += ratePerMin(t) * ((t - prev) / MINUTE);
      samples.push([iso(t), Math.round(value)]);
      prev = t;
    }
    return { hours, samples };
  };

  const pushCounter = (
    name: string,
    labels: Record<string, string> | null,
    ratePerMin: (t: number) => number,
    startValue: number,
  ): void => {
    const { hours, samples } = walk(ratePerMin, startValue);
    const hash = labelsHash(labels ?? undefined);
    metricSeries.push({ service, name, labels, labelsHash: hash, points: samples });
    const hourRows: RollupRow[] = [];
    for (const [hourStart, last] of hours) {
      hourRows.push([iso(hourStart), 240, last * 240, last, last, last]);
    }
    rollupSeries.push({ service, name, labels, labelsHash: hash, hours: hourRows });
  };

  /* The clock: constant, labels-less — a changing value reads as a restart and voids the bucket.
   * Staggered per service, because a fleet whose every process started the same second is a lie. */
  const startEpoch = Math.floor((REFERENCE_MS - 9 * DAY) / 1000) - int(0, 200_000);
  pushCounter("process_start_time_seconds", null, () => 0, startEpoch);

  const routeOk = profile.routes[0].route;
  const routeMiss = (profile.routes[1] ?? profile.routes[0]).route;
  const routeErr = profile.routes[profile.routes.length - 1].route;
  pushCounter(
    "http_requests_total",
    { method: "GET", route: routeOk, status_code: "200" },
    (t) => rpm(profile, "2xx", t),
    int(40_000, 90_000),
  );
  if (flagship) {
    pushCounter(
      "http_requests_total",
      { method: "GET", route: routeMiss, status_code: "404" },
      (t) => rpm(profile, "4xx", t),
      int(1_000, 4_000),
    );
  }
  pushCounter(
    "http_requests_total",
    { method: "GET", route: routeErr, status_code: "500" },
    (t) => rpm(profile, "5xx", t),
    int(20, 400),
  );

  /* Bucket counters must be cumulative across `le` at every instant, so the smaller bounds start
   * from proportionally smaller values — histogram_quantile reads increments, but a corpus a
   * person opens should not show le=0.025 ahead of le=+Inf. */
  const bucketStart = int(120_000, 160_000);
  for (const le of LE_BOUNDS) {
    pushCounter(
      "http_request_duration_seconds_bucket",
      { le, method: "GET", route: durationRoute },
      (t) => {
        const total = rpm(profile, "2xx", t) + rpm(profile, "4xx", t) + rpm(profile, "5xx", t);
        return total * leShares(profile, t)[le];
      },
      Math.round(bucketStart * leShares(profile, REFERENCE_MS - 30 * DAY)[le]),
    );
  }

  /* Runtime gauges: the tile reads only the last five minutes, so twenty is plenty of history. */
  const gauge = (name: string, labels: Record<string, string> | null, valueAt: (t: number) => number): void => {
    const points: SeriesPoint[] = [];
    for (let t = REFERENCE_MS - 20 * MINUTE; t <= REFERENCE_MS; t += 15 * 1000) {
      points.push([iso(t), valueAt(t)]);
    }
    metricSeries.push({ service, name, labels, labelsHash: labelsHash(labels ?? undefined), points });
  };

  const heapBase = (isFront ? 96_000_000 : 128_000_000) + int(0, 44_000_000);
  gauge("nodejs_heap_size_used_bytes", null, (t) =>
    Math.round(heapBase + 9_000_000 * Math.sin(t / (3 * MINUTE)) + rand() * 2_000_000),
  );
  gauge("nodejs_heap_size_total_bytes", null, () => heapBase + 38_000_000);
  gauge("nodejs_eventloop_lag_p99_seconds", null, () => Number((0.006 + rand() * 0.02).toFixed(4)));
  if (!isFront) {
    // A Next front holds no database pool; inventing one would be the corpus lying about the app.
    gauge("db_pool_connections", { state: "active" }, () => int(0, 3));
    gauge("db_pool_connections", { state: "idle" }, () => int(6, 9));
    gauge("db_pool_connections", { state: "waiting" }, () => 0);
  }
}

/* ── health probes — the five services the registry actually probes ───────────────────────────── */

type HealthRow = {
  ts: string;
  httpStatus: number | null;
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
  checks: Record<string, { status: string; latencyMs: number }> | null;
  version: string | null;
};

const PROBED: Array<{ service: string; api: boolean; version: string | null }> = [
  { service: "iknos-api", api: true, version: "2026.08.30-5c514cb" },
  { service: "iknos-front", api: false, version: null },
  { service: "pfa-nest-api", api: true, version: "2026.08.22-c41d09a" },
  { service: "worldweathr-api", api: true, version: "2026.08.27-8b3e1f2" },
  { service: "worldweathr-front", api: false, version: null },
];

const health: Array<{ service: string; rows: HealthRow[] }> = [];

for (const { service, api, version } of PROBED) {
  const rows: HealthRow[] = [];
  /* Thinned to 5-minute steps in the far past, but at the prober's true 30 s cadence across the
   * last four hours — the I3 outage lives there, and a 20-minute outage at five-minute steps
   * would be four sad rows instead of a band. */
  const grid: number[] = [];
  for (let t = REFERENCE_MS - 71 * HOUR; t < REFERENCE_MS - 4 * HOUR; t += 5 * MINUTE) grid.push(t);
  for (let t = REFERENCE_MS - 4 * HOUR; t <= REFERENCE_MS; t += 30 * 1000) grid.push(t);

  for (const t of grid) {
    const inOutage = service === "worldweathr-api" && t >= I3_START && t < I3_END;
    if (inOutage) {
      const transport = chance(0.35);
      rows.push({
        ts: iso(t),
        httpStatus: transport ? null : 503,
        ok: false,
        latencyMs: transport ? null : int(140, 900),
        error: transport ? "fetch failed: connect ECONNREFUSED 127.0.0.1:6500" : null,
        checks: transport
          ? null
          : { db: { status: "ok", latencyMs: int(2, 5) }, redis: { status: "error", latencyMs: int(1800, 2600) } },
        version: null,
      });
      continue;
    }
    rows.push({
      ts: iso(t),
      httpStatus: 200,
      ok: true,
      latencyMs: int(2, api ? 18 : 60),
      error: null,
      checks: api
        ? { db: { status: "ok", latencyMs: int(1, 6) }, redis: { status: "ok", latencyMs: int(0, 3) } }
        : null,
      version,
    });
  }
  health.push({ service, rows });
}

/* ── the machine, and its processes ───────────────────────────────────────────────────────────── */

type HostRow = {
  ts: string;
  cpuPct: number | null;
  load1: number;
  load5: number;
  load15: number;
  memUsedBytes: number;
  memTotalBytes: number;
  diskUsedBytes: number | null;
  diskTotalBytes: number | null;
};

const MEM_TOTAL = 8_326_512_640;
const DISK_TOTAL = 168_577_851_392;

const host: HostRow[] = [];
{
  const grid: number[] = [];
  for (let t = REFERENCE_MS - 71 * HOUR; t < REFERENCE_MS - HOUR; t += 15 * MINUTE) grid.push(t);
  for (let t = REFERENCE_MS - HOUR; t <= REFERENCE_MS; t += 30 * 1000) grid.push(t);
  grid.forEach((t, i) => {
    const hour = new Date(t).getUTCHours();
    const busy = HOUR_WEIGHT[hour];
    host.push({
      ts: iso(t),
      cpuPct: i === 0 ? null : Number((3 + busy * 11 + rand() * 5).toFixed(1)),
      load1: Number((0.15 + busy * 0.55 + rand() * 0.25).toFixed(2)),
      load5: Number((0.2 + busy * 0.45).toFixed(2)),
      load15: Number((0.22 + busy * 0.35).toFixed(2)),
      memUsedBytes: Math.round(3_900_000_000 + busy * 550_000_000 + rand() * 120_000_000),
      memTotalBytes: MEM_TOTAL,
      diskUsedBytes: Math.round(99_000_000_000 + ((t - (REFERENCE_MS - 72 * HOUR)) / DAY) * 210_000_000),
      diskTotalBytes: DISK_TOTAL,
    });
  });
}

type ProcessRow = {
  ts: string;
  pm2Name: string;
  pm2Id: number;
  status: string;
  restarts: number;
  cpuPct: number | null;
  memBytes: number | null;
  startedAt: string | null;
  nodeVersion: string | null;
};

const processes: ProcessRow[] = [];
{
  const facts = PROFILES.map((profile, i) => ({
    name: profile.name,
    pm2Id: i,
    stopped: profile.name === "hiwaysim",
    restarts: profile.name === "worldweathr-api" ? 7 : int(0, 4),
    startedAt: REFERENCE_MS - int(2, 12) * DAY + int(0, 20) * HOUR,
    mem: int(58, 240) * 1_000_000,
  }));
  /* worldweathr-api restarted after I3 — its startedAt is recent and its counter one higher. */
  const weathr = facts.find((f) => f.name === "worldweathr-api");
  if (weathr !== undefined) weathr.startedAt = bootAt;

  for (let t = REFERENCE_MS - 20 * MINUTE; t <= REFERENCE_MS; t += 30 * 1000) {
    for (const fact of facts) {
      processes.push({
        ts: iso(t),
        pm2Name: fact.name,
        pm2Id: fact.pm2Id,
        status: fact.stopped ? "stopped" : "online",
        restarts: fact.restarts,
        cpuPct: fact.stopped ? null : Number((rand() * 7).toFixed(1)),
        memBytes: fact.stopped ? null : fact.mem + int(-3, 3) * 500_000,
        startedAt: fact.stopped ? iso(REFERENCE_MS - 21 * DAY) : iso(fact.startedAt),
        nodeVersion: fact.stopped ? null : "24.5.0",
      });
    }
  }
}

/* ── issues — the corpus's recurring errors, grouped the way the grouper would ─────────────────── */

type IssueEventRow = { ts: string; traceId: string | null; message: string; stack: string | null; count: number };
type IssueRow = {
  fingerprint: string;
  service: string;
  type: string | null;
  message: string;
  culprit: string | null;
  level: number;
  levelName: string;
  status: string;
  regression: boolean;
  firstSeen: string;
  lastSeen: string;
  eventCount: number;
  sample: Record<string, unknown> | null;
  events: IssueEventRow[];
};

const issues: IssueRow[] = [];
for (const template of ERROR_TEMPLATES) {
  const occurrences = occurrencesByTemplate.get(template) ?? [];
  if (occurrences.length === 0) continue;
  const fingerprint = fingerprintOf({
    service: template.service,
    type: template.type,
    stack: template.stack,
    message: template.message,
  });
  const events: IssueEventRow[] = template.clusters.map(([daysAgo, count]) => ({
    ts: iso(REFERENCE_MS - daysAgo * DAY),
    traceId: chance(0.3) ? traceId() : null,
    message: template.message,
    stack: template.stack,
    count,
  }));
  const eventCount = template.clusters.reduce((a, [, n]) => a + n, 0);
  issues.push({
    fingerprint,
    service: template.service,
    type: template.type,
    message: template.message,
    culprit: culpritOf(normaliseFrames(template.stack)),
    level: template.levelName === "fatal" ? 60 : 50,
    levelName: template.levelName,
    status: template.status,
    regression: template.regression,
    firstSeen: iso(REFERENCE_MS - template.firstSeenDaysAgo * DAY),
    lastSeen: iso(occurrences[occurrences.length - 1]),
    eventCount,
    sample: { message: template.message, stack: template.stack, logger: template.logger },
    events,
  });
}

/* ── alerts — three closed episodes matching the incidents; open ones belong to the engine ────── */

type AlertChange = { ts: string; fromState: string | null; toState: string; value: number | null };
type AlertRow = {
  ruleKey: string;
  service: string;
  severity: string;
  title: string;
  expr: string;
  threshold: number | null;
  unit: string | null;
  value: number | null;
  state: string;
  openedAt: string;
  pendingSince: string | null;
  firedAt: string | null;
  resolvedAt: string | null;
  ackedAt: string | null;
  occurrences: number;
  lastSeenAt: string;
  changes: AlertChange[];
};

const alerts: AlertRow[] = [
  {
    ruleKey: "error_rate",
    service: "worldweathr-api",
    severity: "warning",
    title: "5xx rate above threshold",
    expr: "rate(http_5xx[10m]) > 5%",
    threshold: 5,
    unit: "percent",
    value: 2.1,
    state: "resolved",
    openedAt: iso(I1_START + 2 * MINUTE),
    pendingSince: iso(I1_START + 2 * MINUTE),
    firedAt: iso(I1_START + 7 * MINUTE),
    resolvedAt: iso(I1_END + 9 * MINUTE),
    ackedAt: iso(I1_START + 15 * MINUTE),
    occurrences: 31,
    lastSeenAt: iso(I1_END + 9 * MINUTE),
    changes: [
      { ts: iso(I1_START + 2 * MINUTE), fromState: null, toState: "pending", value: 9.4 },
      { ts: iso(I1_START + 7 * MINUTE), fromState: "pending", toState: "firing", value: 41.8 },
      { ts: iso(I1_END + 9 * MINUTE), fromState: "firing", toState: "resolved", value: 2.1 },
    ],
  },
  {
    ruleKey: "latency_p95",
    service: "pfa-nest-api",
    severity: "warning",
    title: "p95 latency above threshold",
    expr: "p95(http_duration[10m]) > 1000ms",
    threshold: 1000,
    unit: "ms",
    value: 240,
    state: "resolved",
    openedAt: iso(I2_START + 4 * MINUTE),
    pendingSince: iso(I2_START + 4 * MINUTE),
    firedAt: iso(I2_START + 9 * MINUTE),
    resolvedAt: iso(I2_END + 11 * MINUTE),
    ackedAt: null,
    occurrences: 44,
    lastSeenAt: iso(I2_END + 11 * MINUTE),
    changes: [
      { ts: iso(I2_START + 4 * MINUTE), fromState: null, toState: "pending", value: 1420 },
      { ts: iso(I2_START + 9 * MINUTE), fromState: "pending", toState: "firing", value: 2380 },
      { ts: iso(I2_END + 11 * MINUTE), fromState: "firing", toState: "resolved", value: 240 },
    ],
  },
  {
    ruleKey: "health_down",
    service: "worldweathr-api",
    severity: "critical",
    title: "Health endpoint failing",
    expr: "probe_failures[90s] >= 2",
    threshold: 2,
    unit: "count",
    value: 0,
    state: "resolved",
    openedAt: iso(I3_START + MINUTE),
    pendingSince: null,
    firedAt: iso(I3_START + MINUTE),
    resolvedAt: iso(I3_END + 2 * MINUTE),
    ackedAt: iso(I3_START + 6 * MINUTE),
    occurrences: 20,
    lastSeenAt: iso(I3_END + 2 * MINUTE),
    changes: [
      { ts: iso(I3_START + MINUTE), fromState: null, toState: "firing", value: 2 },
      { ts: iso(I3_END + 2 * MINUTE), fromState: "firing", toState: "resolved", value: 0 },
    ],
  },
];

/*
 * Every service had a bad moment this week — the history the rail panel and the resolved view read.
 * One to three closed episodes per service, rule and timing drawn from the PRNG; the three
 * hand-written ones above stay tied to their incidents. All closed: open alerts are the engine's.
 */
type RuleShape = {
  key: string;
  severity: string;
  title: string;
  expr: string;
  threshold: number;
  unit: string;
  immediate: boolean;
  peak: () => number;
  settled: () => number;
};
const RULE_SHAPES: RuleShape[] = [
  {
    key: "latency_p95",
    severity: "warning",
    title: "p95 latency above threshold",
    expr: "p95(http_duration[10m]) > 1000ms",
    threshold: 1000,
    unit: "ms",
    immediate: false,
    peak: () => int(1100, 3400),
    settled: () => int(180, 600),
  },
  {
    key: "error_rate",
    severity: "warning",
    title: "5xx rate above threshold",
    expr: "rate(http_5xx[10m]) > 5%",
    threshold: 5,
    unit: "percent",
    immediate: false,
    peak: () => Number((6 + rand() * 30).toFixed(1)),
    settled: () => Number((rand() * 2).toFixed(1)),
  },
  {
    key: "health_down",
    severity: "critical",
    title: "Health endpoint failing",
    expr: "probe_failures[90s] >= 2",
    threshold: 2,
    unit: "count",
    immediate: true,
    peak: () => int(2, 4),
    settled: () => 0,
  },
  {
    key: "process_restart",
    severity: "critical",
    title: "Process restarted",
    expr: "increase(pm2_restarts[10m]) > 0",
    threshold: 0,
    unit: "count",
    immediate: true,
    peak: () => int(1, 3),
    settled: () => 0,
  },
  {
    key: "no_logs",
    severity: "warning",
    title: "Service has gone silent",
    expr: "log_lines[1h] >= 60 and absent(log_lines[15m])",
    threshold: 60,
    unit: "count",
    immediate: true,
    peak: () => int(60, 400),
    settled: () => int(60, 400),
  },
];

for (const profile of PROFILES) {
  const episodes = profile.name === "hiwaysim" ? 1 : int(1, 3);
  for (let k = 0; k < episodes; k++) {
    const rule = pick(RULE_SHAPES);
    const openedAt = REFERENCE_MS - int(3, 160) * HOUR - int(0, 59) * MINUTE;
    const firedAt = rule.immediate ? openedAt : openedAt + int(3, 6) * MINUTE;
    const resolvedAt = firedAt + int(4, 40) * MINUTE;
    const peak = rule.peak();
    const settled = rule.settled();
    const acked = chance(0.4);
    const changes: AlertChange[] = rule.immediate
      ? [{ ts: iso(openedAt), fromState: null, toState: "firing", value: peak }]
      : [
          { ts: iso(openedAt), fromState: null, toState: "pending", value: peak },
          { ts: iso(firedAt), fromState: "pending", toState: "firing", value: peak },
        ];
    changes.push({ ts: iso(resolvedAt), fromState: "firing", toState: "resolved", value: settled });
    alerts.push({
      ruleKey: rule.key,
      service: profile.name,
      severity: rule.severity,
      title: rule.title,
      expr: rule.expr,
      threshold: rule.threshold,
      unit: rule.unit,
      value: settled,
      state: "resolved",
      openedAt: iso(openedAt),
      pendingSince: rule.immediate ? null : iso(openedAt),
      firedAt: iso(firedAt),
      resolvedAt: iso(resolvedAt),
      ackedAt: acked ? iso(firedAt + int(1, 8) * MINUTE) : null,
      occurrences: Math.max(1, Math.round((resolvedAt - firedAt) / MINUTE)),
      lastSeenAt: iso(resolvedAt),
      changes,
    });
  }
}

/* ── write everything ─────────────────────────────────────────────────────────────────────────── */

mkdirSync(join(OUT_DIR, "logs"), { recursive: true });

let logLines = 0;
for (const [service, lines] of linesByService) {
  lines.sort((a, b) => a.ts - b.ts);
  const body = lines.map((l) => l.text).join("\n");
  writeFileSync(join(OUT_DIR, "logs", `${service}.ndjson`), `${body}\n`);
  logLines += lines.length;
}

const stableJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

writeFileSync(join(OUT_DIR, "metrics.json"), stableJson(metricSeries));
writeFileSync(join(OUT_DIR, "rollups.json"), stableJson(rollupSeries));
writeFileSync(join(OUT_DIR, "health.json"), stableJson(health));
writeFileSync(join(OUT_DIR, "host.json"), stableJson(host));
writeFileSync(join(OUT_DIR, "processes.json"), stableJson(processes));
writeFileSync(join(OUT_DIR, "issues.json"), stableJson(issues));
writeFileSync(join(OUT_DIR, "alerts.json"), stableJson(alerts));

const metricRows = metricSeries.reduce((a, s) => a + s.points.length, 0);
const rollupRows = rollupSeries.reduce((a, s) => a + s.hours.length, 0);
const healthRows = health.reduce((a, s) => a + s.rows.length, 0);
console.log(
  `corpus written — ${logLines} log lines across ${linesByService.size} services, ` +
    `${metricRows} metric samples, ${rollupRows} rollup hours, ${healthRows} health probes, ` +
    `${host.length} host samples, ${processes.length} process samples, ${issues.length} issues, ${alerts.length} alerts`,
);

/** Verified fingerprint sanity: sha256 backing both hashes, same as production. */
const digest = createHash("sha256")
  .update(issues.map((i) => i.fingerprint).join(""))
  .digest("hex")
  .slice(0, 12);
console.log(`fingerprint digest ${digest} — changes only when the error templates do`);
