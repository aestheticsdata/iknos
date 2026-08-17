import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { whereClause } from "./log-query";
import { ROW_COLUMNS } from "./row";

import type { LogFilters } from "./log-query";
import type { RawLogRow } from "./row";

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
}
