import { PrismaService } from "@db/prisma.service";
import { Prisma } from "@generated/prisma/client";
import { Injectable } from "@nestjs/common";
import { whereClause } from "./log-query";
import { DETAIL_COLUMNS, ROW_COLUMNS } from "./row";

import type { LogFilters, PageDirection } from "./log-query";
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
   * The rows nearest the cursor, in the direction `dir` walks — **not** always newest first.
   *
   * `"before"` (the default, and the only direction before IKN-59) matches the `(service, ts)` and
   * `(level, ts)` indexes on their leading columns directly: `ORDER BY ts DESC, id DESC` is the
   * index order, and this already comes back newest first.
   *
   * `"after"` needs the opposite scan (`ASC, ASC`) to find the rows *nearest* the cursor rather
   * than the *furthest* — `LIMIT` keeps whichever end of the sort it is given, so walking
   * newest-first toward a lower bound would return the wrong `limit` rows outright, not just in
   * the wrong order. That leaves this batch oldest-first, and it stays that way on purpose: the
   * caller asks for one row more than it needs specifically to trim the farthest one off *before*
   * deciding the page is done, and "farthest" only means "last in this array" while the array is
   * still in the order the cursor produced it. Reversing here, ahead of that trim, would hand the
   * controller a batch whose first and last extremes have swapped roles — see the `LogsController`
   * comment on `boundary` for what that got wrong the first time this was written.
   */
  async search(
    filters: LogFilters,
    limit: number,
    cursor?: { ts: Date; id: bigint },
    dir: PageDirection = "before",
  ): Promise<RawLogRow[]> {
    const order = dir === "before" ? Prisma.sql`ts DESC, id DESC` : Prisma.sql`ts ASC, id ASC`;

    return this.prisma.$queryRaw<RawLogRow[]>`
      SELECT ${ROW_COLUMNS}
        FROM log_entry
       WHERE ${whereClause(filters, cursor, dir)}
       ORDER BY ${order}
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
