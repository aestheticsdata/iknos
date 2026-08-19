import { PrismaService } from "@db/prisma.service";
import { Injectable } from "@nestjs/common";
import { whereClause } from "./log-query";

import type { Bucket } from "@contracts/histogram";
import type { LogFilters } from "./log-query";

/**
 * The volume chart above the log list: one count per interval, split by severity.
 *
 * The only real logic here is choosing the interval, and it is pure, so it is tested without a
 * database.
 */

/** As many bars as a chart of this width can distinguish, and a hard ceiling on the GROUP BY. */
export const MAX_BUCKETS = 60;

/** Round steps a human reads off an axis without doing arithmetic: 1s, 5s, 15s, 1m, 5m … 1d. */
const STEPS_MS = [1_000, 5_000, 15_000, 60_000, 300_000, 900_000, 3_600_000, 21_600_000, 86_400_000];

/**
 * The smallest round step that keeps the bucket count within the ceiling.
 *
 * **The server decides the granularity, not the caller.** A week requested in one-second
 * intervals is six hundred thousand rows out of MySQL and six hundred thousand points into a
 * chart nobody can read; the range is the client's to choose and the resolution is not.
 *
 * Always a whole number of seconds, which is what lets the query bucket on `TIMESTAMPDIFF(SECOND,
 * …)`. Microseconds would overflow `BIGINT` on an absurdly wide window and return silent nonsense
 * instead of an error.
 */
export function chooseBucketMs(fromMs: number, toMs: number): number {
  const span = Math.max(toMs - fromMs, 1);
  const fit = STEPS_MS.find((step) => span / step <= MAX_BUCKETS);
  // Past the largest round step, stop being pretty and divide. The ceiling is a guarantee; round
  // numbers on the axis are only a preference.
  return fit ?? Math.ceil(span / MAX_BUCKETS / 1000) * 1000;
}

type RawBucket = { bucket: bigint; error: bigint; warn: bigint; info: bigint };

@Injectable()
export class HistogramService {
  constructor(private readonly prisma: PrismaService) {}

  async histogram(filters: LogFilters): Promise<{ bucketMs: number; buckets: Bucket[] }> {
    const bucketMs = chooseBucketMs(+filters.from, +filters.to);

    const rows = await this.prisma.$queryRaw<RawBucket[]>`
      SELECT CAST(FLOOR(TIMESTAMPDIFF(SECOND, ${filters.from}, ts) / ${bucketMs / 1000}) AS SIGNED) AS bucket,
             CAST(SUM(level >= 50) AS SIGNED) AS error,
             CAST(SUM(level  = 40) AS SIGNED) AS warn,
             CAST(SUM(level  < 40) AS SIGNED) AS info
        FROM log_entry
       WHERE ${whereClause(filters)}
       GROUP BY bucket
       ORDER BY bucket`;

    return { bucketMs, buckets: fill(rows, +filters.from, +filters.to, bucketMs) };
  }
}

/**
 * Empty intervals become rows of zeroes here rather than in SQL.
 *
 * A range with no logs has to return the full span of bars, not a short array: the x-axis stays
 * the range the user asked for, and a quiet hour reads as quiet rather than as missing.
 *
 * `CAST(… AS SIGNED)` in the query is what makes these plain integers — MySQL's `SUM` returns a
 * `DECIMAL`, which the driver hands back as an object that would serialise to `{}`.
 */
function fill(rows: RawBucket[], fromMs: number, toMs: number, bucketMs: number): Bucket[] {
  const found = new Map(rows.map((r) => [Number(r.bucket), r]));
  const count = Math.ceil((toMs - fromMs) / bucketMs);

  return Array.from({ length: count }, (_, i) => {
    const row = found.get(i);
    return {
      t: new Date(fromMs + i * bucketMs).toISOString(),
      error: Number(row?.error ?? 0),
      warn: Number(row?.warn ?? 0),
      info: Number(row?.info ?? 0),
    };
  });
}
