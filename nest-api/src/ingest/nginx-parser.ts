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

  const attrs: Record<string, unknown> = {};
  if (referrer !== null) attrs.referrer = referrer;
  if (userAgent !== null) attrs.userAgent = userAgent;
  if (protocol !== null) attrs.protocol = protocol;
  if (query !== null) attrs.query = query;
  if (bytes !== null) attrs.bytes = bytes;

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
    // combined has no $request_time. A log_format carrying one would be a change to every vhost
    // that wants it — spec §10.
    durationMs: null,
    clientIp: m[1],
    userId: dashless(m[3]),
    // No $host in combined, which is exactly why each vhost writes its own file and the service
    // comes from the registry row rather than from the line.
    hostname: null,
    attrs: Object.keys(attrs).length > 0 ? attrs : null,
  };
}
