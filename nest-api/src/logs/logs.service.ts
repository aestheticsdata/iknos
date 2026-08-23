import { PrismaService } from "@db/prisma.service";
import { Injectable } from "@nestjs/common";
import { whereClause } from "./log-query";
import { DETAIL_COLUMNS, ROW_COLUMNS } from "./row";

import type { LogFilters } from "./log-query";
import type { RawLogDetail, RawLogRow } from "./row";

/**
 * The search itself. Raw SQL rather than the Prisma query API, for two reasons that both come
 * down to expressiveness: six optional filters compose into a `WHERE` far more legibly as a list
 * of `Prisma.Sql` fragments than as a conditionally-built `where` object, and the keyset
 * comparison `(ts, id) < (?, ?)` has no Prisma equivalent at all.
 *
 * Raw does not mean unsafe. Every value is a bound parameter; nothing is interpolated into the
 * SQL text, here or in `whereClause`.
 */
@Injectable()
export class LogsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Newest first — the order the Logs view reads in, and the order the cursor walks.
   *
   * `ORDER BY ts DESC, id DESC` matches the `(service, ts)` and `(level, ts)` indexes on their
   * leading columns, and `id` breaks the tie between rows written in the same millisecond, which
   * at this volume is most of them.
   */
  async search(filters: LogFilters, limit: number, cursor?: { ts: Date; id: bigint }): Promise<RawLogRow[]> {
    return this.prisma.$queryRaw<RawLogRow[]>`
      SELECT ${ROW_COLUMNS}
        FROM log_entry
       WHERE ${whereClause(filters, cursor)}
       ORDER BY ts DESC, id DESC
       LIMIT ${limit}`;
  }

  /**
   * One row, in full — the four columns the list deliberately leaves behind (IKN-58).
   *
   * **Bounded like everything else, and here it is the primary key that needs it.** `log_entry` is
   * partitioned by day and keyed on `(id, ts)`; `WHERE id = ?` alone names no partition, so MySQL
   * probes the primary key of every one of them across the whole retention window. The caller is
   * asking about a row it has just read and therefore knows the timestamp of, so the range costs
   * it nothing and turns the lookup into a single-partition point read.
   *
   * `LIMIT 1` even though `(id, ts)` is unique: an id is unique across the table, not within the
   * range the caller happened to pass, and a scan that stops at the first hit says so.
   */
  async byId(id: bigint, from: Date, to: Date): Promise<RawLogDetail | null> {
    const rows = await this.prisma.$queryRaw<RawLogDetail[]>`
      SELECT ${DETAIL_COLUMNS}
        FROM log_entry
       WHERE id = ${id} AND ts >= ${from} AND ts < ${to}
       LIMIT 1`;

    return rows[0] ?? null;
  }
}
