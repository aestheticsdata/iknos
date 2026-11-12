import { PrismaService } from "@db/prisma.service";
import { Prisma } from "@generated/prisma/client";
import { IngestService } from "@ingest/ingest.service";
import { Injectable } from "@nestjs/common";
import { ingestedThrough, likeSubtree, p95Offset } from "./sli-rules";

import type { SliWindow } from "@contracts/sli";
import type { SliQuery } from "./interfaces/sli-types";

type CountRow = { requests: bigint | number; errors5xx: bigint | number | string | null; timed: bigint | number };

/** `COUNT` comes back as a BigInt and `SUM` as a Decimal string; both fit a number at these sizes. */
const toCount = (value: bigint | number | string | null): number => (value === null ? 0 : Number(value));

/**
 * One window's indicators, computed on read from `log_entry` (IKN-88).
 *
 * Two statements and no table of its own. The first counts; the second fetches the single duration
 * at the 95th percentile's rank, so memory stays flat however busy the window was — a bot storm
 * costs MySQL a sort, not the API an array of a million numbers. `(service, ts)` serves both.
 */
@Injectable()
export class SliService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingest: IngestService,
  ) {}

  async window(query: SliQuery): Promise<SliWindow> {
    // Read before the counts, never after: a pass that lands between the two would otherwise vouch
    // for lines the counts never saw.
    const through = ingestedThrough(this.ingest.stats());
    const where = whereFor(query);

    const [counts] = await this.prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*) AS requests,
             SUM(status_code >= 500) AS errors5xx,
             COUNT(duration_ms) AS timed
        FROM log_entry
       WHERE ${where}`;

    const requests = toCount(counts?.requests ?? 0);
    const timed = toCount(counts?.timed ?? 0);
    const offset = p95Offset(timed);

    let p95Ms: number | null = null;
    if (offset !== null) {
      const [row] = await this.prisma.$queryRaw<{ durationMs: number }[]>`
        SELECT duration_ms AS durationMs
          FROM log_entry
         WHERE ${where} AND duration_ms IS NOT NULL
         ORDER BY duration_ms
         LIMIT 1 OFFSET ${offset}`;
      p95Ms = row === undefined ? null : Number(row.durationMs);
    }

    return {
      service: query.service,
      from: query.from.toISOString(),
      to: query.to.toISOString(),
      pathPrefix: query.pathPrefix,
      excludePathPrefix: query.excludePathPrefix,
      requests,
      errors5xx: toCount(counts?.errors5xx ?? 0),
      timed,
      p95Ms,
      ingestedThrough: through?.toISOString() ?? null,
    };
  }
}

/**
 * nginx lines only, and only the ones the parser could read — a degraded line has no status, and
 * counting it as a request would dilute the error rate with lines that say nothing.
 */
function whereFor(query: SliQuery): Prisma.Sql {
  const base = Prisma.sql`service = ${query.service}
     AND logger = 'nginx.access'
     AND status_code IS NOT NULL
     AND ts >= ${query.from} AND ts < ${query.to}`;

  const include =
    query.pathPrefix === null
      ? Prisma.empty
      : Prisma.sql` AND (route = ${query.pathPrefix} OR route LIKE ${likeSubtree(query.pathPrefix)})`;

  // A line with no route (a scanner's garbage request line) belongs to no subtree, so it stays on
  // the "everything else" side rather than vanishing from both.
  const exclude =
    query.excludePathPrefix === null
      ? Prisma.empty
      : Prisma.sql` AND (route IS NULL OR NOT (route = ${query.excludePathPrefix} OR route LIKE ${likeSubtree(query.excludePathPrefix)}))`;

  return Prisma.sql`${base}${include}${exclude}`;
}
