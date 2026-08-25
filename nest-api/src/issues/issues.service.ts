import { readJsonColumn } from "@common/json-column";
import { PrismaService } from "@db/prisma.service";
import { Prisma } from "@generated/prisma/client";
import { Injectable } from "@nestjs/common";
import { ERROR_LEVEL } from "./error-fields";
import { SORTS, whereClause } from "./issue-query";
import { ISSUE_COLUMNS, ISSUE_DETAIL_COLUMNS } from "./issue-row";

import type { IssueCounts } from "@contracts/issue-page";
import type { IssueStatus } from "@contracts/issue-row";
import type { GroupableRow } from "./coalesce";
import type { IssueFilters, IssueSort } from "./issue-query";
import type { RawIssueDetail, RawIssueRow } from "./issue-row";

/**
 * The read and write side of the issues view (IKN-14).
 *
 * Raw SQL rather than the Prisma query API, for the reason `LogsService` gives: the keyset
 * comparison `(last_seen, id) < (?, ?)` has no Prisma equivalent, and the bucketing below is a
 * `GROUP BY` on an expression. Raw does not mean unsafe — every value is a bound parameter and
 * nothing is interpolated into the SQL text, here or in `whereClause`.
 */

/** The sparkline's window: `EVENTS·48h` is the mockup's own column header. */
export const SPARK_WINDOW_MS = 48 * 3_600_000;

/**
 * Bars in a sparkline, and buckets in the modal's chart when the caller names no range.
 *
 * Twenty-four over forty-eight hours is a bar every two hours. The rail draws them 52 pixels
 * wide, so more bars would be sub-pixel and fewer would hide a burst inside a flat one.
 */
export const SPARK_BUCKETS = 24;

type RawBucket = { issueId: number; bucket: bigint | number; n: bigint | number };
/** `GroupableRow` as the driver hands it back — `attrs` still whatever the JSON column gave. */
type RawGroupableRow = Omit<GroupableRow, "attrs"> & { attrs: unknown };

@Injectable()
export class IssuesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A page of issues, nearest the cursor.
   *
   * One direction only, unlike the log list. A log page is a window onto a stream a reader walks
   * both ways from an anchor; this is a list read from the top down, and there is no "jump to an
   * issue in the middle" to walk backwards from.
   *
   * `id DESC` is the tiebreaker on every sort, so two issues sharing a `last_seen` — one pass
   * writes them together — have a total order and the keyset cannot repeat or skip them.
   */
  async list(
    filters: IssueFilters,
    sort: IssueSort,
    limit: number,
    cursor?: { key: number; id: number },
  ): Promise<RawIssueRow[]> {
    const { column } = SORTS[sort];

    return this.prisma.$queryRaw<RawIssueRow[]>`
      SELECT ${ISSUE_COLUMNS}
        FROM issue
       WHERE ${whereClause(filters, cursor, sort)}
       ORDER BY ${column} DESC, id DESC
       LIMIT ${limit}`;
  }

  /**
   * Occurrences per bucket for a whole page of issues, in one query.
   *
   * One query rather than one per row: the table draws a sparkline on every line, and forty round
   * trips for forty charts 52 pixels wide is the shape of request that makes a page feel broken.
   *
   * `SUM(count)`, never `COUNT(*)` — `issue_event` holds one *sample* per fingerprint per pass and
   * each row carries how many throws it stands for. Counting rows would draw the number of passes
   * that saw the error, which is four a minute whether it threw four times or four thousand.
   */
  async sparks(ids: number[], from: Date, to: Date, bucketMs: number): Promise<Map<number, number[]>> {
    const count = Math.ceil((+to - +from) / bucketMs);
    const empty = () => new Array<number>(count).fill(0);
    // Every issue on the page gets a series whether or not it has events in the window: a row
    // whose last occurrence predates the window is a flat line, not a missing chart.
    const series = new Map(ids.map((id) => [id, empty()]));
    if (ids.length === 0) return series;

    const rows = await this.prisma.$queryRaw<RawBucket[]>`
      SELECT issue_id AS issueId,
             CAST(FLOOR(TIMESTAMPDIFF(SECOND, ${from}, ts) / ${bucketMs / 1000}) AS SIGNED) AS bucket,
             CAST(SUM(count) AS SIGNED) AS n
        FROM issue_event
       WHERE issue_id IN (${Prisma.join(ids)})
         AND ts >= ${from} AND ts < ${to}
       GROUP BY issue_id, bucket`;

    for (const row of rows) {
      const bucket = Number(row.bucket);
      // Guarded rather than trusted: a row exactly on `to` would land one past the end, and
      // writing past an array's length in JavaScript makes a longer array rather than an error.
      if (bucket < 0 || bucket >= count) continue;
      const into = series.get(Number(row.issueId));
      if (into !== undefined) into[bucket] = Number(row.n);
    }

    return series;
  }

  /**
   * The three segment counts, in one pass over the table.
   *
   * `GROUP BY status` rather than three `COUNT(*)` queries: the three numbers are read together,
   * shown together and have to agree with each other, and three round trips could each see a
   * different state of the table while the collector writes.
   *
   * The `status` filter is deliberately dropped — this *is* the breakdown by status — while
   * `service` is kept, so the number beside a segment counts what that segment would show under
   * the scope the rest of the screen is under.
   */
  async counts(filters: IssueFilters): Promise<IssueCounts> {
    const rows = await this.prisma.$queryRaw<{ status: string; n: bigint | number }[]>`
      SELECT status, CAST(COUNT(*) AS SIGNED) AS n
        FROM issue
       WHERE ${whereClause({ service: filters.service })}
       GROUP BY status`;

    const found = new Map(rows.map((row) => [row.status, Number(row.n)]));
    return {
      unresolved: found.get("unresolved") ?? 0,
      resolved: found.get("resolved") ?? 0,
      ignored: found.get("ignored") ?? 0,
    };
  }

  /** One issue in full, or null. `fingerprint` is UNIQUE, so this is a point read. */
  async byFingerprint(fingerprint: string): Promise<RawIssueDetail | null> {
    const rows = await this.prisma.$queryRaw<RawIssueDetail[]>`
      SELECT ${ISSUE_DETAIL_COLUMNS}
        FROM issue
       WHERE fingerprint = ${fingerprint}
       LIMIT 1`;

    return rows[0] ?? null;
  }

  /**
   * The error rows around one log line, for `fingerprintForLog`.
   *
   * The same projection, the same predicate and the same order the grouper's own pass uses, so the
   * exception rebuilt here is the exception it grouped. Bounded on `service` as well as on time:
   * `coalesce` joins per service, and reading the other services' rows would only add work.
   */
  async around(service: string, at: Date, windowMs: number): Promise<GroupableRow[]> {
    const rows = await this.prisma.$queryRaw<RawGroupableRow[]>`
      SELECT id, ts, service, level, level_name AS levelName, message, trace_id AS traceId, attrs
        FROM log_entry
       WHERE service = ${service}
         AND level >= ${ERROR_LEVEL}
         AND ts >= ${new Date(+at - windowMs)}
         AND ts <= ${new Date(+at + windowMs)}
       ORDER BY ts ASC, id ASC`;

    return rows.map((row) => ({ ...row, attrs: readJsonColumn(row.attrs) }));
  }

  /** The internal id behind a fingerprint, or null. Nothing outside this module ever sees it. */
  async idOf(fingerprint: string): Promise<number | null> {
    const rows = await this.prisma.$queryRaw<{ id: number }[]>`
      SELECT id FROM issue WHERE fingerprint = ${fingerprint} LIMIT 1`;

    return rows[0] === undefined ? null : Number(rows[0].id);
  }

  /** One issue's occurrences, bucketed — the same arithmetic as `sparks`, for a single row. */
  async occurrences(issueId: number, from: Date, to: Date, bucketMs: number): Promise<number[]> {
    const series = await this.sparks([issueId], from, to, bucketMs);
    return series.get(issueId) ?? [];
  }

  /**
   * Moves an issue between the three segments. `false` means there is no such fingerprint.
   *
   * **Resolving clears `regression`, and nothing else touches it.** The flag means "this came back
   * after someone said it was handled", which is a fact about the episode that is now ending — and
   * it is self-healing either way, because the grouper sets it again the moment a resolved issue
   * recurs. Left set, it would ride along through a resolve and reappear on a fresh reopen that
   * nobody's fix regressed.
   *
   * `last_seen` and `event_count` are untouched: a reader deciding an issue is handled is not an
   * occurrence of it.
   */
  async setStatus(fingerprint: string, status: IssueStatus): Promise<boolean> {
    const regression = status === "resolved" ? Prisma.sql`, regression = FALSE` : Prisma.empty;

    const changed = await this.prisma.$executeRaw`
      UPDATE issue SET status = ${status}${regression} WHERE fingerprint = ${fingerprint}`;

    // Zero rows means either "no such issue" or "it was already in that state", and MySQL does not
    // distinguish them by default. Asked separately rather than guessed at: a mutation answering
    // 404 because the reader clicked resolve twice would be a bug with a very confusing report.
    return changed > 0 || (await this.idOf(fingerprint)) !== null;
  }
}
