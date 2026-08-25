import { decodeKeysetCursor } from "@common/keyset-cursor";
import { Prisma } from "@generated/prisma/client";
import { BadRequestException } from "@nestjs/common";
import { IsOptional, IsString } from "class-validator";

import type { IssueStatus } from "@contracts/issue-row";

/**
 * The issues list's vocabulary, parsed once (IKN-14).
 *
 * Same shape as `logs/log-query.ts` and same reason: the list, the counts and the sparkline query
 * all narrow on the same two filters, and a segment count that disagreed with the list under it
 * would be worse than no count at all.
 *
 * **No time range, and that is not an oversight.** `log_entry` is partitioned by day and its
 * routes refuse an unbounded query because one forgotten parameter is a full scan of the retention
 * period. `issue` is unpartitioned and holds one row per distinct error — hundreds, not hundreds
 * of millions. Bounding it by time would also hide exactly the issue whose value is that it is
 * old and still unresolved.
 */

/** Fields arrive as strings and are converted here — the global pipe runs without `transform`. */
export class IssueQueryDto {
  @IsOptional() @IsString() service?: string;
  /** One of the three segments. Absent means all three. */
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() sort?: string;
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @IsString() limit?: string;
}

export const STATUSES: IssueStatus[] = ["unresolved", "resolved", "ignored"];

/**
 * Sorts, and the column each one pages on.
 *
 * `keyOf` and `column` have to name the same thing or the cursor walks a different order than the
 * `ORDER BY` — so they sit in one object per sort rather than in two switches that could drift.
 */
export const SORTS = {
  /** Default: what broke most recently is what a triage list opens on. */
  last: { column: Prisma.sql`last_seen`, keyOf: (r: SortKeys) => r.lastSeen.getTime(), temporal: true },
  first: { column: Prisma.sql`first_seen`, keyOf: (r: SortKeys) => r.firstSeen.getTime(), temporal: true },
  volume: { column: Prisma.sql`event_count`, keyOf: (r: SortKeys) => r.eventCount, temporal: false },
} as const;

export type IssueSort = keyof typeof SORTS;
type SortKeys = { lastSeen: Date; firstSeen: Date; eventCount: number };

export type IssueFilters = {
  service?: string;
  status?: IssueStatus;
};

export const MAX_LIMIT = 200;
export const DEFAULT_LIMIT = 50;

/**
 * Anything that is not one of the three sorts means the default.
 *
 * Lenient, like `parseDir`: a sort comes off a URL, an unrecognised one still has an obvious
 * answer, and the reader gets a list rather than an error page.
 */
export function parseSort(raw: string | undefined): IssueSort {
  return raw !== undefined && raw in SORTS ? (raw as IssueSort) : "last";
}

/**
 * A status filter, or `undefined` for all three.
 *
 * **Strict where `sort` is lenient**, and the difference is what a wrong value would do. An
 * unrecognised sort shows the right issues in a different order; an unrecognised status would
 * quietly show *every* issue while the segment above the list claims to be narrowing them. A
 * filter that does not filter is the one failure this list cannot afford.
 */
export function parseStatus(raw: string | undefined): IssueStatus | undefined {
  if (!raw) return undefined;
  if (!STATUSES.includes(raw as IssueStatus)) {
    throw new BadRequestException(`'status' must be one of: ${STATUSES.join(", ")}`);
  }
  return raw as IssueStatus;
}

export function parseFilters(p: IssueQueryDto): IssueFilters {
  // `|| undefined` rather than `??`: `?service=` is a filter the UI cleared, not a filter for the
  // empty string.
  return { service: p.service || undefined, status: parseStatus(p.status) };
}

export function parseLimit(raw: string | undefined): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new BadRequestException("'limit' must be an integer");
  // Clamped rather than refused — an oversized page is a caller being optimistic.
  return Math.min(Math.max(n, 1), MAX_LIMIT);
}

/**
 * Sixteen hex characters, or a 400.
 *
 * Checked rather than passed straight to the query: a fingerprint is what every issue route is
 * keyed on, and a value that could not be one is a malformed request, not a lookup that happens
 * to miss. `CHAR(16)` would also compare a longer string by truncation on some collations, which
 * is a 404 turning into the wrong issue.
 */
export function parseFingerprint(raw: string): string {
  if (!/^[0-9a-f]{16}$/.test(raw)) throw new BadRequestException("'fingerprint' must be 16 hex characters");
  return raw;
}

/**
 * The `WHERE`, shared by the list and the counts.
 *
 * `status` is dropped when the counts query runs — it groups by status — but `service` is not,
 * which is the whole point of one builder: the number beside a segment is a count of what that
 * segment would show under the same service scope.
 *
 * Every value is a bound parameter. Nothing is interpolated into the SQL text.
 */
export function whereClause(
  f: IssueFilters,
  cursor?: { key: number; id: number },
  sort: IssueSort = "last",
): Prisma.Sql {
  const parts: Prisma.Sql[] = [];

  if (f.service !== undefined) parts.push(Prisma.sql`service = ${f.service}`);
  if (f.status !== undefined) parts.push(Prisma.sql`status = ${f.status}`);

  if (cursor !== undefined) {
    // A row-value comparison rather than `col < ? OR (col = ? AND id < ?)`: issues sharing a
    // `last_seen` millisecond are ordinary — one pass writes them all — and the two-clause form is
    // where a keyset walk starts repeating them.
    const { column, temporal } = SORTS[sort];
    const key = temporal ? Prisma.sql`${new Date(cursor.key)}` : Prisma.sql`${cursor.key}`;
    parts.push(Prisma.sql`(${column}, id) < (${key}, ${cursor.id})`);
  }

  // `TRUE` rather than an empty fragment: the unfiltered list is the common case and a `WHERE`
  // with nothing after it is a syntax error.
  return parts.length === 0 ? Prisma.sql`TRUE` : Prisma.join(parts, " AND ");
}

/** A cursor off the URL, or nothing. Undecodable means "first page" — see `decodeKeysetCursor`. */
export function resolveCursor(p: IssueQueryDto): { key: number; id: number } | undefined {
  return p.cursor ? (decodeKeysetCursor(p.cursor) ?? undefined) : undefined;
}

/** The occurrence chart's range. Both optional — see `parseOccurrenceWindow`. */
export class OccurrenceQueryDto {
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}

/** How far back the occurrence chart looks when the caller names no range — the mockup's 48 h. */
export const DEFAULT_OCCURRENCE_WINDOW_MS = 48 * 3_600_000;

/**
 * The range for one issue's occurrences, defaulted rather than demanded.
 *
 * **The opposite rule to `logs/log-query.ts`, and deliberately.** There, a missing bound is a 400
 * because an unbounded query scans every partition ever retained. Here the query is already
 * narrowed to one `issue_id` on an indexed, day-partitioned table, so the range is a view
 * preference rather than a safety rail — and the front is better off not putting a moving `now`
 * in the URL, which is what asking for both bounds would force it to do.
 *
 * A bound that will not parse is treated as absent, for the same reason `parseAt` is lenient: it
 * comes off a URL, and the request still has a sensible answer without it.
 */
export function parseOccurrenceWindow(p: OccurrenceQueryDto, now: number): { from: Date; to: Date } {
  const at = (raw: string | undefined): Date | null => {
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isNaN(+parsed) ? null : parsed;
  };

  const to = at(p.to) ?? new Date(now);
  const from = at(p.from) ?? new Date(+to - DEFAULT_OCCURRENCE_WINDOW_MS);
  // A range that is not a range would divide by a negative span and produce an empty chart with
  // no explanation. Refused, unlike the individual bounds: this one cannot be defaulted past.
  if (to <= from) throw new BadRequestException("'to' must be after 'from'");

  return { from, to };
}
