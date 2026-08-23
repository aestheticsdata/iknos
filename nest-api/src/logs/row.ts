import { readJsonColumn } from "@common/json-column";
import { Prisma } from "@generated/prisma/client";

import type { LogDetail } from "@contracts/log-detail";
import type { LogRow } from "@contracts/log-row";

/**
 * The one place a `log_entry` row becomes a `LogRow`.
 *
 * The column list and the mapper live together and are used by both the search and the trace, so
 * a row arriving from either is the same shape without anyone having to keep two `SELECT`s in
 * step. The live tail builds the same shape from a `LogRecord` instead — see the stream
 * controller — because those rows have not been read back from the database at all.
 */

/** What the raw driver hands back for the column list below. */
export type RawLogRow = {
  id: bigint;
  ts: Date;
  service: string;
  level: number;
  levelName: string;
  message: string;
  traceId: string | null;
  httpMethod: string | null;
  route: string | null;
  statusCode: number | null;
  durationMs: number | null;
};

/**
 * Explicit, never `SELECT *`: `attrs` is a JSON blob that would be fetched and discarded on
 * every one of two hundred rows, and `message` is a TEXT column heavy enough already.
 */
export const ROW_COLUMNS = Prisma.sql`
  id, ts, service, level, level_name AS levelName, message, trace_id AS traceId,
  http_method AS httpMethod, route, status_code AS statusCode, duration_ms AS durationMs`;

export function toLogRow(r: RawLogRow): LogRow {
  return {
    ...r,
    // Both conversions are load-bearing rather than cosmetic: `JSON.stringify` throws outright on
    // a BigInt, and a `Date` would serialise to a local-time-flavoured string.
    id: r.id.toString(),
    ts: r.ts.toISOString(),
  };
}

/**
 * The same row, plus the four columns the list leaves in the table — `GET /api/logs/entry/:id`.
 *
 * Deliberately expressed as `ROW_COLUMNS` widened rather than as a second hand-written list. The
 * contract says a `LogDetail` *is* a `LogRow` with more on it, and two independent lists would let
 * the expanded pane and the line above it drift into disagreeing about the same event.
 */
export const DETAIL_COLUMNS = Prisma.sql`
  ${ROW_COLUMNS}, client_ip AS clientIp, user_id AS userId, hostname, attrs`;

export type RawLogDetail = RawLogRow & {
  clientIp: string | null;
  userId: string | null;
  hostname: string | null;
  /** Whatever the driver made of the JSON column — see `readJsonColumn`. */
  attrs: unknown;
};

export function toLogDetail(r: RawLogDetail): LogDetail {
  return {
    ...toLogRow(r),
    clientIp: r.clientIp,
    userId: r.userId,
    hostname: r.hostname,
    // A blob that will not parse is a line with no extra attributes, not a 500: the row itself is
    // still the answer to what was asked, and the four fields beside it are still true.
    attrs: readJsonColumn(r.attrs),
  };
}
