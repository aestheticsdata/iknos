import { createServer } from "node:http";
import { CLIENT_IPS, ERROR_TEMPLATES, HOSTNAME, HOUR_WEIGHT, PROFILES, USER_AGENTS, USER_IDS } from "./profiles";

import type { Profile, Route } from "./profiles";

/**
 * One member of the mock fleet (IKN-64): a real process, under a real pm2, doing the three things a
 * monitored app does — it writes ECS lines to stdout, it answers its health route, and it serves
 * `/metrics`. The unmodified collector, prober, scraper and alert engine then simply observe it.
 *
 * **Random by design**, the opposite of `author.ts`. The corpus is the past and must be replayable;
 * this is the present and must not repeat itself — a demo whose live tail loops the same twelve
 * lines is a screensaver. Rates follow the same day curve as the corpus, latencies the same
 * long tail, errors the same recurring stacks (so the grouper folds live occurrences into the
 * issues the corpus already knows), and every few hours a service has a short bad moment: 5xx,
 * slow answers, a health route saying 503 — enough for the engine to open and close real alerts.
 *
 * Volume is the one thing kept modest on purpose: a few lines a minute per service, so a laptop
 * running the fleet for a week grows the database by megabytes, not gigabytes. Retention does the
 * rest (`IKNOS_RETENTION_DAYS`, `IKNOS_METRIC_RETENTION_DAYS`).
 */

/* ── arguments ────────────────────────────────────────────────────────────────────────────────── */

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1] !== undefined) return process.argv[i + 1];
  if (fallback !== undefined) return fallback;
  console.error(`fleet-node: missing --${name}`);
  process.exit(1);
}

const SERVICE = arg("service");
const PORT = Number(arg("port"));
const KIND = arg("kind", "api") as "api" | "front" | "stopped";
const HEALTH_PATH = arg("health", "/health");
const METRICS_PATH = arg("metrics", "/metrics");

function characterOf(service: string): Profile {
  const found = PROFILES.find((p) => p.name === service);
  if (found === undefined) {
    console.error(`fleet-node: no profile for ${service}`);
    process.exit(1);
  }
  return found;
}

const profile = characterOf(SERVICE);
const errorsOfService = ERROR_TEMPLATES.filter((t) => t.service === SERVICE);

/* ── randomness — the real thing, on purpose ──────────────────────────────────────────────────── */

const rand = Math.random;
const chance = (p: number): boolean => rand() < p;
const int = (lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];

function gauss(): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}
const lognormal = (median: number, sigma: number): number => median * Math.exp(sigma * gauss());

function traceId(): string {
  let out = "";
  for (let i = 0; i < 32; i++) out += "0123456789abcdef"[Math.floor(rand() * 16)];
  return out;
}

const MINUTE = 60_000;

/* ── the lines ────────────────────────────────────────────────────────────────────────────────── */

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

function ecs(level: string, message: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    "@timestamp": new Date().toISOString(),
    "log.level": level,
    "log.logger": profile.logger,
    message,
    "host.hostname": HOSTNAME,
    ...extra,
  });
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

/** A short bad moment: 5xx, slow answers, a health route in 503. Ends on its own. */
let incidentUntil = 0;
const inIncident = (): boolean => Date.now() < incidentUntil;

/* Roughly one incident per service per four hours, at the fleet's own emission rate — often enough
   that the alerts panel usually has something firing somewhere in the fleet. */
const INCIDENT_CHANCE_PER_LINE = 1 / 1_000;

/* ── the counters `/metrics` exposes, bumped by the lines themselves ──────────────────────────── */

const LE_BOUNDS = ["0.025", "0.1", "0.5", "1", "+Inf"];
const routeOk = profile.routes[0].route;
const routeMiss = (profile.routes[1] ?? profile.routes[0]).route;
const routeErr = profile.routes[profile.routes.length - 1].route;

/** Series key → cumulative value. Keys carry the labels in the exposition's own syntax. */
const counters = new Map<string, number>();
const bump = (key: string): void => {
  counters.set(key, (counters.get(key) ?? 0) + 1);
};
const labelsOf = (pairs: Record<string, string>): string =>
  `{${Object.entries(pairs)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}="${v}"`)
    .join(",")}}`;

for (const [route, status] of [
  [routeOk, "200"],
  [routeMiss, "404"],
  [routeErr, "500"],
] as const) {
  counters.set(`http_requests_total${labelsOf({ method: "GET", route, status_code: status })}`, 0);
}
for (const le of LE_BOUNDS) {
  counters.set(`http_request_duration_seconds_bucket${labelsOf({ le, method: "GET", route: routeOk })}`, 0);
}

function httpLine(): void {
  const route = weightedRoute(profile.routes);
  const bad = inIncident();
  const status = bad
    ? chance(0.55)
      ? 500
      : 200
    : chance(0.955)
      ? route.method === "POST" && chance(0.7)
        ? 201
        : 200
      : chance(0.75)
        ? pick([301, 400, 404])
        : 500;
  const durationMs = Math.max(1, Math.round(lognormal(route.median, 0.7) * (bad ? 6 : 1)));
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
  if (chance(0.2)) extra["trace.id"] = traceId();
  write(ecs(level, `${route.method} ${route.route} ${status} in ${durationMs} ms`, extra));

  const cls = status >= 500 ? "500" : status >= 400 ? "404" : "200";
  const labelledRoute = cls === "200" ? routeOk : cls === "404" ? routeMiss : routeErr;
  bump(`http_requests_total${labelsOf({ method: "GET", route: labelledRoute, status_code: cls })}`);
  for (const le of LE_BOUNDS) {
    if (le === "+Inf" || durationMs / 1000 <= Number(le)) {
      bump(`http_request_duration_seconds_bucket${labelsOf({ le, method: "GET", route: routeOk })}`);
    }
  }
}

function eventLine(): void {
  const level = chance(profile.debug / (profile.debug + 0.2)) ? "debug" : "info";
  write(ecs(level, pick(profile.events).replace("{n}", String(int(3, 4200))), { pid: process.pid }));
}

function errorLine(): void {
  const template = pick(errorsOfService);
  const extra: Record<string, unknown> = { "error.message": template.message, req_id: `req-${int(100000, 999999)}` };
  if (template.type !== null) extra["error.type"] = template.type;
  if (template.stack !== null) extra["error.stack_trace"] = template.stack;
  if (chance(0.4)) extra["trace.id"] = traceId();
  const message = template.type !== null ? `${template.type}: ${template.message}` : template.message;
  write(ecs(template.levelName, message, extra));
}

function emit(): void {
  if (!inIncident() && chance(INCIDENT_CHANCE_PER_LINE)) {
    incidentUntil = Date.now() + int(2, 6) * MINUTE;
    write(ecs("warn", "upstream latency climbing, circuit half-open", { breaker: "half-open" }));
  }
  const roll = rand();
  const errorShare = inIncident() ? 0.25 : 0.04;
  if (roll < 0.72) httpLine();
  else if (roll < 1 - errorShare || errorsOfService.length === 0) eventLine();
  else errorLine();
}

/** Lines per minute: the corpus's day curve, scaled to the service's weight, doubled in trouble. */
function ratePerMinute(): number {
  const curve = HOUR_WEIGHT[new Date().getUTCHours()];
  return (0.6 + profile.weight * 25) * curve * (inIncident() ? 2.5 : 1);
}

function scheduleNext(): void {
  const mean = MINUTE / Math.max(ratePerMinute(), 0.3);
  // Exponential gaps: Poisson arrivals, the shape real traffic has and a metronome does not.
  const delay = Math.min(-Math.log(1 - rand()) * mean, 5 * MINUTE);
  setTimeout(() => {
    emit();
    scheduleNext();
  }, delay);
}

/* ── gauges — a heap that breathes, a loop that hiccups, a pool that fills under stress ────────── */

const startedAtSec = Math.floor(Date.now() / 1000);
const heapFloor = (KIND === "front" ? 96_000_000 : 128_000_000) + int(0, 44_000_000);
let heapUsed = heapFloor + int(0, 9_000_000);

function gauges(): string[] {
  heapUsed = Math.min(heapFloor + 30_000_000, Math.max(heapFloor, heapUsed + int(-2_500_000, 3_000_000)));
  const lag = inIncident() ? 0.02 + rand() * 0.16 : 0.006 + rand() * 0.02;
  const lines = [
    `nodejs_heap_size_used_bytes ${heapUsed}`,
    `nodejs_heap_size_total_bytes ${heapFloor + 38_000_000}`,
    `nodejs_eventloop_lag_p99_seconds ${lag.toFixed(4)}`,
  ];
  if (KIND === "api") {
    const active = inIncident() ? int(8, 10) : int(0, 3);
    lines.push(
      `db_pool_connections{state="active"} ${active}`,
      `db_pool_connections{state="idle"} ${10 - active}`,
      `db_pool_connections{state="waiting"} ${inIncident() ? int(1, 4) : 0}`,
    );
  }
  return lines;
}

function exposition(): string {
  const out = ["# TYPE process_start_time_seconds gauge", `process_start_time_seconds ${startedAtSec}`];
  out.push("# TYPE http_requests_total counter", "# TYPE http_request_duration_seconds_bucket counter");
  for (const [key, value] of counters) out.push(`${key} ${value}`);
  out.push(...gauges());
  return `${out.join("\n")}\n`;
}

/* ── the two routes the collector asks ────────────────────────────────────────────────────────── */

function healthBody(): { status: number; body: string; type: string } {
  if (KIND === "front") {
    return { status: 200, type: "text/html", body: `<!doctype html><title>${SERVICE}</title>` };
  }
  const bad = inIncident();
  const body = {
    status: bad ? "degraded" : "ok",
    checks: {
      db: { status: "ok", latencyMs: int(1, 6) },
      redis: bad ? { status: "error", latencyMs: int(1800, 2600) } : { status: "ok", latencyMs: int(0, 3) },
    },
    version: "2026.09.01-mock",
  };
  return { status: bad ? 503 : 200, type: "application/json", body: JSON.stringify(body) };
}

const server = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  if (path === METRICS_PATH) {
    res.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" });
    res.end(exposition());
    return;
  }
  if (path === HEALTH_PATH || (KIND === "front" && path === "/")) {
    const { status, body, type } = healthBody();
    res.writeHead(status, { "content-type": type });
    res.end(body);
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found\n");
});

/* ── boot ─────────────────────────────────────────────────────────────────────────────────────── */

/* The plain-text grade, on purpose: a boot banner is what an uninstrumented process prints, and the
   parser's degraded path deserves a line a day too. */
const stamp = new Date().toLocaleString("en-US");
write(`[Nest] ${process.pid}  - ${stamp}     LOG [NestFactory] Starting Nest application...`);

if (KIND === "stopped") {
  // pm2 started this with --no-autorestart: exiting here is what "stopped in pm2" looks like.
  write(`[Nest] ${process.pid}  - ${stamp}     LOG [NestApplication] stopped by operator`);
  process.exit(0);
}

server.on("error", (err: NodeJS.ErrnoException) => {
  // A taken port is reported, not hidden: pm2 shows the process errored, and the rail shows red.
  write(`[Nest] ${process.pid}  - ${stamp}   ERROR [NestApplication] ${err.code ?? err.message} on 127.0.0.1:${PORT}`);
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  write(
    `[Nest] ${process.pid}  - ${stamp}     LOG [NestApplication] Nest application successfully started on :${PORT}`,
  );
  scheduleNext();
});
