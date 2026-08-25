import { readJsonColumn } from "@common/json-column";
import { Prisma } from "@generated/prisma/client";

import type { IssueDetail } from "@contracts/issue-detail";
import type { IssueRow, IssueStatus } from "@contracts/issue-row";

/**
 * The one place an `issue` row becomes an `IssueRow` (IKN-14).
 *
 * Column list and mapper together, the shape `logs/row.ts` established: the list, the rail panel
 * and the modal all read through here, so none of them can end up describing the same error
 * differently because someone edited one `SELECT`.
 */

/** What the raw driver hands back for the column list below. */
export type RawIssueRow = {
  id: number;
  fingerprint: string;
  service: string;
  type: string | null;
  message: string;
  culprit: string | null;
  level: number;
  levelName: string;
  status: string;
  /**
   * `BOOLEAN` is `TINYINT(1)` in MySQL, and what the driver makes of that through `$queryRaw` is
   * its own business — 0/1 through one path, `true`/`false` through another. Typed as both and
   * coerced once, rather than shipping `regression: 1` to a front expecting a boolean.
   */
  regression: number | boolean;
  firstSeen: Date;
  lastSeen: Date;
  eventCount: number;
  firstRelease: string | null;
  lastRelease: string | null;
};

/**
 * Explicit, never `SELECT *`: `sample` is a JSON blob holding a whole stack trace, and fetching
 * it for every row of a list that shows none of them is the one column worth naming to leave out.
 *
 * `id` is selected even though it never reaches the contract — the cursor pages on it, and the
 * sparkline query joins on it.
 */
export const ISSUE_COLUMNS = Prisma.sql`
  id, fingerprint, service, type, message, culprit, level, level_name AS levelName,
  status, regression, first_seen AS firstSeen, last_seen AS lastSeen, event_count AS eventCount,
  first_release AS firstRelease, last_release AS lastRelease`;

/**
 * The same row plus the stack — `GET /api/issues/:fingerprint`.
 *
 * Expressed as `ISSUE_COLUMNS` widened rather than as a second hand-written list, for the reason
 * `DETAIL_COLUMNS` gives: the contract says a detail *is* a row with more on it, and two lists
 * would let the modal and the line that opened it disagree about the same error.
 */
export const ISSUE_DETAIL_COLUMNS = Prisma.sql`${ISSUE_COLUMNS}, sample`;

export type RawIssueDetail = RawIssueRow & {
  /** Whatever the driver made of the JSON column — see `readJsonColumn`. */
  sample: unknown;
};

/**
 * A status column that is not one of the three is read as `unresolved`.
 *
 * The column is a `VarChar` because the schema has no enums, so nothing at the database level
 * stops a hand-written `UPDATE` from putting something else there. Defaulting to the segment the
 * issue would want attention in beats letting an unknown string reach a `Record<IssueStatus, …>`
 * lookup in the front and render as an empty cell.
 */
const statusOf = (raw: string): IssueStatus =>
  raw === "resolved" || raw === "ignored" || raw === "unresolved" ? raw : "unresolved";

export function toIssueRow(r: RawIssueRow, spark: number[]): IssueRow {
  return {
    fingerprint: r.fingerprint,
    service: r.service,
    type: r.type,
    message: r.message,
    culprit: r.culprit,
    level: Number(r.level),
    levelName: r.levelName,
    status: statusOf(r.status),
    regression: Boolean(r.regression),
    // A `Date` does not survive JSON in either direction — the same conversion `toLogRow` makes.
    firstSeen: r.firstSeen.toISOString(),
    lastSeen: r.lastSeen.toISOString(),
    eventCount: Number(r.eventCount),
    firstRelease: r.firstRelease,
    lastRelease: r.lastRelease,
    spark,
  };
}

/**
 * The sample as the grouper wrote it: `{ ts, traceId, stack }`.
 *
 * A blob that will not read is `latest: null`, never a 500. The issue itself — what it is, how
 * often, since when — is still the answer to what was asked, and the modal has four tiles that do
 * not depend on the stack.
 */
export function toIssueDetail(r: RawIssueDetail, spark: number[]): IssueDetail {
  const sample = readJsonColumn(r.sample);
  const ts = typeof sample?.ts === "string" ? new Date(sample.ts) : null;

  return {
    ...toIssueRow(r, spark),
    latest:
      ts === null || Number.isNaN(+ts)
        ? null
        : {
            ts: ts.toISOString(),
            traceId: typeof sample?.traceId === "string" ? sample.traceId : null,
            stack: typeof sample?.stack === "string" ? sample.stack : null,
          },
  };
}
