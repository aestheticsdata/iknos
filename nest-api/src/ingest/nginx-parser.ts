import { redactQuery } from "@common/redact-query";
import { LEVELS } from "./parser";

import type { LogRecord } from "./log-record";

/**
 * nginx's `combined` format — one line into the same `LogRecord` a tailed ECS line becomes.
 *
 * The point of going through `LogRecord` rather than a second row shape is that everything
 * downstream stays ignorant of the difference: the writer, the bus, the live tail and the Logs
 * view cannot tell an access line from a posted browser error, and do not need to.
 *
 * ```
 * $remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent"
 * ```
 *
 * **Anchored, and built from negated classes** — `[^"]*` rather than `.*?` — because this runs on
 * every line of every access log and the ingestion path forbids a regex that can backtrack.
 * `LineBuffer` has already capped the line at 1 MB before it arrives.
 */
const COMBINED = /^(\S+) (\S+) (\S+) \[([^\]]+)\] "([^"]*)" (\d{3}) (\d+|-) "([^"]*)" "([^"]*)"/;

/**
 * What ks-b's `main` format writes after the combined fields since IKN-88:
 *
 * ```
 * "$http_x_forwarded_for" $request_time "$upstream_status" "$host"
 * ```
 *
 * The timing goes **before** `"$host"` rather than after it, so the host stays the last quoted field
 * and `trailingHost` reads every line the way it always has. Anchored at both ends: a line written
 * before IKN-88 (`"xff" "host"`) or by a vhost still on `combined` (nothing at all) does not match,
 * and its duration stays unknown rather than being guessed from whichever field happens to sit there.
 */
const TIMING_TAIL = /^ "[^"]*" (\d+(?:\.\d+)?|-) "([^"]*)" "[^"]*"$/;

type Timing = { durationMs: number | null; upstreamStatus: string | null };

/**
 * `$request_time` is seconds with millisecond resolution (`0.012`), from the first byte read off the
 * client to the last byte written back — what the visitor waited, upstream included.
 *
 * `$upstream_status` stays a string: nginx writes `-` when nothing was proxied, and `502, 200` when
 * it tried two upstreams, and neither is a number. It is the field that tells a 502 nginx produced
 * because the app was down from one the app sent itself.
 */
function parseTiming(rest: string): Timing {
  const m = TIMING_TAIL.exec(rest);
  if (m === null) return { durationMs: null, upstreamStatus: null };

  const seconds = m[1] === "-" ? Number.NaN : Number(m[1]);
  return {
    durationMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : null,
    upstreamStatus: dashless(m[2]),
  };
}

/** `16/Sep/2026:14:02:31 +0200` — nginx's own, which `new Date()` does not read. */
const TIME_LOCAL = /^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/;

const MONTHS: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

/**
 * The offset is **in the line**, and is honoured rather than assumed.
 *
 * ks-b runs on Paris time, so a parser that built a local `Date` would be right today and an hour
 * out after the October change — and every range query against these rows silently wrong with it.
 * `log_entry` is partitioned by day on `ts`, so an hour of drift can also file a row in the wrong
 * partition.
 */
function parseTimeLocal(raw: string): Date | null {
  const m = TIME_LOCAL.exec(raw);
  if (m === null) return null;

  const month = MONTHS[m[2]];
  if (month === undefined) return null;

  const offsetMinutes = (m[7] === "-" ? -1 : 1) * (Number(m[8]) * 60 + Number(m[9]));
  const asUtc = Date.UTC(Number(m[3]), month, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6]));
  const ts = new Date(asUtc - offsetMinutes * 60_000);

  return Number.isNaN(ts.getTime()) ? null : ts;
}

/** nginx writes `-` for "there was none". Storing that string would make it look like a value. */
const dashless = (value: string): string | null => (value === "" || value === "-" ? null : value);

/**
 * The status code is the only thing an access line says about severity, so it is what the level
 * comes from. This is what lets the existing level filter, and a `level >= 50` search across every
 * service, work on these rows without a second control being invented for them.
 */
function levelFor(status: number): { level: number; levelName: string } {
  if (status >= 500) return { level: LEVELS.error, levelName: "error" };
  if (status >= 400) return { level: LEVELS.warn, levelName: "warn" };
  return { level: LEVELS.info, levelName: "info" };
}

type RequestParts = {
  method: string | null;
  route: string | null;
  query: string | null;
  protocol: string | null;
};

/**
 * `"GET /path?q=1 HTTP/2.0"`, and everything a scanner sends instead.
 *
 * A request line that is not one — a TLS handshake aimed at the plain port, a binary probe —
 * yields nulls rather than an exception. The status code beside it is still a fact worth storing.
 */
function splitRequest(request: string): RequestParts {
  const parts = request.split(" ");
  if (parts.length < 2) return { method: null, route: null, query: null, protocol: null };

  const [method, target] = parts;
  const protocol = parts.length > 2 ? parts[parts.length - 1] : null;
  const q = target.indexOf("?");

  return {
    method,
    route: q === -1 ? target : target.slice(0, q),
    query: q === -1 ? null : target.slice(q + 1),
    protocol,
  };
}

/**
 * A line the pattern did not match, kept as text.
 *
 * `degraded` is the same signal the ECS parser raises at `parser.ts:106` and
 * `GET /api/collector/status` counts it. For nginx it means one of two things, both worth seeing:
 * a `log_format` changed on the box, or a file in the registry that is not an access log at all.
 */
function degraded(message: string, service: string): LogRecord {
  return {
    degraded: true as const,
    ts: new Date(),
    service,
    level: LEVELS.info,
    levelName: "info",
    logger: "nginx.access",
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
 * Never throws, and never returns a half-built record. `null` means "nothing here" — a blank line
 * — and is the only case that stores nothing at all.
 *
 * No clamping happens here on purpose: `toRow` (`writer.ts:59-77`) bounds every column at the
 * writing edge, so a 4 KB request target or a binary method is already incapable of failing an
 * INSERT and poisoning its batch. Clamping twice would only put the limit in two places.
 */
export function parseCombined(line: string, service: string): LogRecord | null {
  const clean = line.trim();
  if (clean === "") return null;

  const m = COMBINED.exec(clean);
  if (m === null) return degraded(clean, service);

  const ts = parseTimeLocal(m[4]);
  if (ts === null) return degraded(clean, service);

  const status = Number(m[6]);
  const { level, levelName } = levelFor(status);
  const { method, route, query, protocol } = splitRequest(m[5]);

  const referrer = dashless(m[8]);
  const userAgent = dashless(m[9]);
  const bytes = m[7] === "-" ? null : Number(m[7]);
  const { durationMs, upstreamStatus } = parseTiming(clean.slice(m[0].length));

  const attrs: Record<string, unknown> = {};
  if (referrer !== null) attrs.referrer = referrer;
  if (userAgent !== null) attrs.userAgent = userAgent;
  if (protocol !== null) attrs.protocol = protocol;
  // Redacted before it is stored (IKN-87): the OTLP beacon carries its write token as `?token=`,
  // because `sendBeacon` cannot set a header, and nginx writes that into `$request` verbatim.
  if (query !== null) attrs.query = redactQuery(query);
  if (bytes !== null) attrs.bytes = bytes;
  if (upstreamStatus !== null) attrs.upstreamStatus = upstreamStatus;

  return {
    ts,
    service,
    level,
    levelName,
    // What tells an access line from a posted browser error inside one service.
    logger: "nginx.access",
    // What the dense table shows in its message column. The route and status are columns too, but
    // a row whose message is empty reads as a blank line in the one place a reader scans.
    message: `${method ?? "?"} ${route ?? "?"} ${status}`,
    traceId: null,
    httpMethod: method,
    route,
    statusCode: status,
    // `main` carries $request_time since IKN-88; `combined`, and any line written before the switch,
    // does not, and stays null. Post-deploy verification reads its p95 off this column.
    durationMs,
    clientIp: m[1],
    userId: dashless(m[3]),
    // The machine, not the site: `$host` is read by `trailingHost` and decides the service instead.
    hostname: null,
    attrs: Object.keys(attrs).length > 0 ? attrs : null,
  };
}

/** What a site name may be once read: letters, digits, dots and dashes, and nothing else. */
const HOST = /^[a-z0-9.-]+$/;

/**
 * The site a line of the shared `access.log` was for (IKN-84).
 *
 * ks-b's global `main` format is combined, then `"$http_x_forwarded_for"`, then since IKN-88
 * `$request_time "$upstream_status"`, then `"$host"` — always the last quoted field. The pattern above is anchored at the start only, so the extra fields leave
 * `parseCombined` reading the same line it always read.
 *
 * String search rather than a regex over the line: it runs on every line of the busiest file on
 * the box. A line written before the host was appended ends on `"-"`, which is no site — `null`,
 * like a line that is not an access line at all.
 */
export function trailingHost(line: string): string | null {
  const clean = line.trimEnd();
  if (clean.length < 2 || !clean.endsWith('"')) return null;

  const open = clean.lastIndexOf('"', clean.length - 2);
  if (open === -1) return null;

  // `$host` is already lower-case and port-free; a hand-written format might not be.
  const host = clean
    .slice(open + 1, -1)
    .toLowerCase()
    .replace(/:\d+$/, "");
  return HOST.test(host) && host !== "-" ? host : null;
}
