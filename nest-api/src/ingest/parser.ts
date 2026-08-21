import { stripVTControlCharacters } from "node:util";
import { INGEST_SKIP_MARKER } from "@common/logger";

import type { LogRecord } from "./log-record";

/**
 * One log line in, one `LogRecord` out — or `null` for the two lines that are deliberately
 * nobody's business: blank ones, and the collector's own write failures (see the marker below).
 *
 * Three grades of input, degrading gracefully: ECS JSON gets its promoted columns, bare JSON gets
 * `msg` and an attrs bag, and anything else is a message whose level is guessed from the stream it
 * arrived on. An unreadable line is stored degraded, never thrown on — a parser that can crash the
 * collector turns one malformed line in one app into a monitoring outage for all of them.
 */

/**
 * pino's numeric levels, which the UI sorts and filters on.
 *
 * Exported because the query side resolves `?level=warn` against the same table. Two maps would
 * be two chances for a name accepted by the filter to mean something else than it did at
 * ingestion — the aliases in particular (`warning`, `crit`) only exist because other loggers
 * emit them, and a filter that did not know them would silently return nothing.
 */
export const LEVELS: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  warning: 40,
  error: 50,
  fatal: 60,
  crit: 60,
  critical: 60,
};

/**
 * What becomes a column, and is therefore removed from `attrs` — nothing is stored twice.
 * `ecs.version` is promoted to nowhere: it says "this line is ECS", which the row's existence
 * already records, so it is simply dropped.
 */
const PROMOTED = [
  "@timestamp",
  "log.level",
  "log.logger",
  "message",
  "trace.id",
  "http.request.method",
  "url.path",
  "http.response.status_code",
  "event.duration",
  "client.ip",
  "user.id",
  "host.hostname",
  "ecs.version",
];

/**
 * Looks a key up in both ECS shapes: dotted (`"log.level"`) and nested (`{log: {level}}`). The
 * spec allows either and loggers differ — pino emits dotted with its ECS formatter, others nest.
 */
function lookup(obj: Record<string, unknown>, dotted: string): unknown {
  if (dotted in obj) return obj[dotted];

  let cur: unknown = obj;
  for (const part of dotted.split(".")) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

const asString = (v: unknown): string | null => (typeof v === "string" ? v : null);
const asNumber = (v: unknown): number | null => (typeof v === "number" ? v : null);

/**
 * `ERROR`, `WARN`, `[Nest] ... LOG` and friends — the prefixes uninstrumented apps actually
 * print. Only the head of the line is examined: "restarted after ERROR" halfway through a
 * sentence is prose, not a severity.
 */
function inferLevel(message: string, fallback: string): string {
  const head = message.slice(0, 24).toUpperCase();
  for (const [needle, level] of [
    ["FATAL", "fatal"],
    ["ERROR", "error"],
    ["ERR", "error"],
    ["WARN", "warn"],
    ["DEBUG", "debug"],
    ["TRACE", "trace"],
  ] as const) {
    if (head.includes(needle)) return level;
  }
  return fallback;
}

/**
 * `degraded` distinguishes the two reasons a line ends up here. A line that was never JSON — most
 * of what `console.log` and every non-pino library emits — is *normal*, and counting it as damage
 * would leave the counter permanently pegged and therefore useless. A line that looked like JSON
 * and would not parse is the one worth surfacing: a truncated write, a rotation that cut a line in
 * half, a logger emitting something malformed.
 */
function plainText(message: string, service: string, fallback: string, degraded = false): LogRecord {
  const levelName = inferLevel(message, fallback);
  return {
    ...(degraded ? { degraded: true as const } : {}),
    ts: new Date(),
    service,
    level: LEVELS[levelName] ?? 30,
    levelName,
    logger: null,
    message,
    traceId: null,
    httpMethod: null,
    route: null,
    statusCode: null,
    durationMs: null,
    clientIp: null,
    userId: null,
    hostname: null,
    attrs: null,
  };
}

/**
 * The fleet's health probes, dropped at the door — and only while they are healthy.
 *
 * Zeus sweeps every service it registers, and four apps log the probe they receive. Measured on
 * ks-b, those lines were the *entirety* of the fleet's steady-state log volume: ten lines a
 * minute, every one of them `GET /health` answered 200, ingested forever by a store with no
 * retention. A monitoring tool whose own reading is the majority of what it stores has failed at
 * its one job, so the line is drawn here, where every stdout line already passes.
 *
 * Two shapes, one meaning. An instrumented app promotes the path into `route`; an uninstrumented
 * one leaves it inside the message (`[Route] GET /api/health \u2192 Nest [127.0.0.1] node`), so the
 * message is only consulted when there is no route to ask. `\b` keeps prose about
 * `/api/healthcheck-partner` out of the blast radius.
 *
 * The guards are the point: nothing at `warn` or above is ever dropped, and neither is a probe
 * that failed \u2014 a health route answering 503 is the one line about it worth keeping. What this
 * deliberately does not try to know is *who* asked: a probe aimed at a business route (Zeus pings
 * shatter at `/api/scores`) is indistinguishable from traffic and is kept, because guessing at
 * requesters is how real requests disappear.
 */
const HEALTH_ROUTE = /^\/(api\/)?health\/?$/;
const HEALTH_PROBE_LINE = /\bGET\s+\/(api\/)?health\b/;

function isHealthProbeNoise(r: LogRecord): boolean {
  if (r.level >= LEVELS.warn) return false;
  if (r.statusCode !== null && r.statusCode >= 400) return false;
  return r.route !== null ? HEALTH_ROUTE.test(r.route) : HEALTH_PROBE_LINE.test(r.message);
}

/**
 * Whether a line was *trying* to be JSON. Only these count towards the degraded tally — plain
 * `console.log` output is not a fault, and counting it as one makes the number meaningless.
 */
const looksLikeJson = (line: string): boolean => line.startsWith("{") || line.startsWith("[");

/**
 * `JSON.parse` on every line is safe from the event-loop rule because `LineBuffer` caps a line at
 * 1 MB before it ever reaches this function.
 */
export function parse(line: string, service: string, stream: "out" | "err"): LogRecord | null {
  const record = parseLine(line, service, stream);
  return record !== null && isHealthProbeNoise(record) ? null : record;
}

function parseLine(line: string, service: string, stream: "out" | "err"): LogRecord | null {
  // Never re-ingest our own write failures — otherwise a database outage becomes an infinite
  // loop: the failure is logged, the log is ingested, the ingestion fails, the failure is logged.
  if (line.includes(INGEST_SKIP_MARKER)) return null;

  const clean = stripVTControlCharacters(line).trim();
  if (clean === "") return null;

  // What `-error.log` says at no particular level is still an error; PM2 routed it there.
  const fallbackLevel = stream === "err" ? "error" : "info";

  let obj: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(clean);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return plainText(clean, service, fallbackLevel);
    }
    obj = parsed as Record<string, unknown>;
  } catch {
    // Truncated or malformed JSON — a rotated file cut mid-line, a logger interrupted mid-write.
    // Stored as text: degraded beats dropped, and the raw line is the whole evidence.
    return plainText(clean, service, fallbackLevel, looksLikeJson(clean));
  }

  const isEcs = "@timestamp" in obj || lookup(obj, "log.level") !== undefined;
  if (!isEcs) {
    const message = asString(obj.msg) ?? asString(obj.message) ?? clean;
    return { ...plainText(message, service, fallbackLevel), attrs: obj };
  }

  const levelName = asString(lookup(obj, "log.level")) ?? fallbackLevel;
  const rawTs = asString(obj["@timestamp"]);
  const parsedTs = rawTs ? new Date(rawTs) : null;
  const ts = parsedTs && !Number.isNaN(parsedTs.getTime()) ? parsedTs : new Date();

  const attrs: Record<string, unknown> = { ...obj };
  for (const key of PROMOTED) {
    delete attrs[key];
    // The nested shape stores `log.level` under `log`; promoting it means the whole subtree is
    // spoken for. Deleting just the leaf would leave `{log: {logger: …}}` half-eaten in attrs.
    if (key.includes(".")) delete attrs[key.split(".")[0]];
  }

  const durationNs = asNumber(lookup(obj, "event.duration"));

  return {
    ts,
    service,
    level: LEVELS[levelName] ?? 30,
    levelName,
    logger: asString(lookup(obj, "log.logger")),
    message: asString(obj.message) ?? "",
    traceId: asString(lookup(obj, "trace.id")),
    httpMethod: asString(lookup(obj, "http.request.method")),
    route: asString(lookup(obj, "url.path")),
    statusCode: asNumber(lookup(obj, "http.response.status_code")),
    // ECS event.duration is nanoseconds.
    durationMs: durationNs === null ? null : Math.round(durationNs / 1_000_000),
    clientIp: asString(lookup(obj, "client.ip")),
    userId: asString(lookup(obj, "user.id")),
    hostname: asString(lookup(obj, "host.hostname")),
    attrs: Object.keys(attrs).length > 0 ? attrs : null,
  };
}
