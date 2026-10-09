import { Prisma } from "@generated/prisma/client";
import { ServiceUnavailableException } from "@nestjs/common";
import { gridStart, windowsFor } from "./metric-window";

import type { PrismaService } from "@db/prisma.service";
import type { SourcePlan } from "./metric-window";
import type { MetricRow } from "./signal-series";

/**
 * The two scans every metric reader goes through (IKN-13, shared since IKN-23).
 *
 * Lifted out of `SignalsService` when the metrics view arrived needing the same rows — the last
 * reading of every series in every interval, out of `metric_rollup` for the part of the range past
 * the raw retention and out of `metric_sample` for the rest. Two copies of these statements would
 * be two places to forget the execution ceiling, the anchoring fix or the partition predicate.
 */

/**
 * Which series of the HTTP metrics to keep, by their `method` and `route` labels.
 *
 * The metrics view's route detail is about one route, and narrowing in SQL is what makes it cheap:
 * the cost of these scans is the sort behind the window function (IKN-66), and the route filter
 * runs before it. Every other metric named — the heartbeat — passes untouched, because it carries
 * no route and is still the clock the intervals are measured against.
 */
export type SeriesFilter = {
  method: string;
  route: string;
  /** The names the filter applies to. Anything else in `names` is read whole. */
  labelled: readonly string[];
};

export type SampleQuery = {
  service: string;
  /** The start of the requested range — the grid's origin, not the start of either window. */
  from: Date;
  to: Date;
  plan: SourcePlan;
  names: readonly string[];
  series?: SeriesFilter;
};

/** A half-open `[from, to)` span of time. */
export type TimeWindow = { from: Date; to: Date };

type SampleRow = {
  bucket: bigint | number;
  ts: Date;
  name: string;
  labelsHash: string;
  labels: unknown;
  value: number;
};

/**
 * The server-side ceiling on one signals scan, in milliseconds.
 *
 * **Strictly below the Prisma pool timeout, and that is the whole point.** These two queries read
 * `metric_sample`, which is by far the largest table here — 1.2 GB of the 1.4 GB database on ks-b,
 * growing ~450 MB a day — and when a scan of it stops fitting in the InnoDB buffer pool its cost
 * goes from milliseconds to tens of seconds. On 2026-08-25 it reached 23 s p50 while the service
 * view polls every `SIGNALS_POLL_MS` (30 s), so each poll opened a new scan before the last had
 * finished. Ten of those is the whole pool, and the API answered nothing at all — not the log
 * panel, not the rail, not `/api/services`, none of which read this table.
 *
 * `MAX_EXECUTION_TIME` makes MySQL itself end the statement, which is the only cancellation that
 * exists here: aborting the HTTP request does not stop the query, and the connection stays
 * checked out until the server is done regardless of who is still listening. Capped below the
 * pool's own patience, a connection is always returned before a waiter gives up, so this endpoint
 * can no longer be the reason an unrelated one fails.
 *
 * It is a ceiling, not a target. A signals scan that needs eight seconds is already useless — the
 * tile it feeds is refetched every thirty — so the range that trips this is one nobody could read
 * anyway. The fix for *why* it trips is `innodb_buffer_pool_size`, which is 128 MB by default and
 * has never been set on ks-b, and `metric_rollup` (IKN-20), which would stop wide ranges reading
 * this table at all.
 */
export const SIGNALS_MAX_EXECUTION_MS = 8_000;

/**
 * MySQL's own code for a statement it ended because of the hint above.
 *
 * Matched on the driver's message rather than on a Prisma error code, because there isn't one:
 * `$queryRaw` surfaces every server-side failure as the same `P2010`, and the distinction that
 * matters here — "this scan was too slow" against "the database is broken" — lives only in the
 * text MySQL sent back. The wording is matched as well as the number so that a future driver that
 * stops quoting the code still lands on the right branch.
 */
export const isExecutionTimeout = (err: unknown): boolean =>
  err instanceof Error && (err.message.includes("3024") || /maximum statement execution time/i.test(err.message));

/**
 * What the view is told when the ceiling trips.
 *
 * Deliberately not `emptySignals`. A scraped service whose scan was cut short has not been
 * measured as flat — answering with the same empty tiles an unscraped service gets would put a
 * confident "no traffic" on screen for a service that may well be on fire. Saying the reading
 * could not be taken is the only honest option, and it is a 503 because it is transient by
 * construction: the same range answers fine once the table fits in the buffer pool again.
 */
export const SIGNALS_TOO_SLOW =
  "the metrics query exceeded its time budget — narrow the range, or see innodb_buffer_pool_size on the host";

/**
 * Every row the plan calls for, from whichever tables it names.
 *
 * At most one round trip per source. A scan MySQL ended on its time budget becomes a 503 here, for
 * every caller at once — see `SIGNALS_TOO_SLOW` for why it is never an empty answer.
 */
export async function readSamples(prisma: PrismaService, query: SampleQuery): Promise<MetricRow[]> {
  const windows = windowsFor(query.from, query.to, query.plan);

  /*
   * The window function picks the last reading of every series in every interval, which is the
   * only reading a counter difference is allowed to be taken from.
   *
   * **What bounds this is the partition pruning, not the index.** `EXPLAIN` on a narrow window
   * takes `(service, name, labels_hash, ts)`, and on a wide one the optimiser costs a scan of the
   * pruned partitions lower and takes that instead — the index covers neither `labels` nor
   * `value`, so every match needs the row anyway. The cost past a certain width is the sort of the
   * qualifying rows rather than the way they were found (IKN-66).
   */
  try {
    const [rollupRows, rawRows] = await Promise.all([
      windows.rollup ? rollupSamples(prisma, query, windows.rollup) : [],
      windows.raw ? rawSamples(prisma, query, windows.raw) : [],
    ]);
    return [...rollupRows, ...rawRows];
  } catch (err) {
    if (isExecutionTimeout(err)) throw new ServiceUnavailableException(SIGNALS_TOO_SLOW);
    throw err;
  }
}

/** `TRUE` without a filter; otherwise the labelled names narrowed to one method and route. */
function seriesClause(series: SeriesFilter | undefined): Prisma.Sql {
  if (series === undefined) return Prisma.sql`TRUE`;

  return Prisma.sql`(name NOT IN (${Prisma.join([...series.labelled])})
                OR (JSON_UNQUOTE(JSON_EXTRACT(labels, '$.method')) = ${series.method}
                    AND JSON_UNQUOTE(JSON_EXTRACT(labels, '$.route')) = ${series.route}))`;
}

/**
 * Last reading per series per interval, from the raw table.
 *
 * The interval index is measured with `TIMESTAMPDIFF(SECOND, …)`, as the log histogram does it
 * (IKN-19) — anchored to a value the server supplies, so the bucketing is immune to whatever time
 * zone the MySQL session happens to sit in.
 *
 * **Anchored one interval early, and shifted back by one.** `TIMESTAMPDIFF` truncates *toward
 * zero*, not downward, so measuring from `origin` files a sample 0.4 s before it into bucket `0`
 * rather than into the priming bucket `-1` — verified in MySQL, not deduced. The `ROW_NUMBER`
 * below then prefers a later reading in that bucket and the priming value is discarded, which
 * leaves the first interval of the chart with no predecessor to be differenced against and
 * therefore blank, for about one scrape in fifteen. Measuring from the priming interval's own
 * start makes every difference non-negative, where truncation and flooring are the same thing.
 *
 * The `ts` predicate is not politeness: `metric_sample` is partitioned by day, and it is what
 * discards whole partitions before a row is read.
 */
async function rawSamples(prisma: PrismaService, query: SampleQuery, window: TimeWindow): Promise<MetricRow[]> {
  const { service, from: origin, plan, names, series } = query;
  const { from, to } = window;
  const bucketSec = plan.bucketMs / 1000;
  const anchor = gridStart(origin, plan.bucketMs, -1);

  const rows = await prisma.$queryRaw<SampleRow[]>`
    SELECT /*+ MAX_EXECUTION_TIME(${Prisma.raw(String(SIGNALS_MAX_EXECUTION_MS))}) */
           bucket, ts, name, labelsHash, labels, value
      FROM (
        SELECT CAST(FLOOR(TIMESTAMPDIFF(SECOND, ${anchor}, ts) / ${bucketSec}) AS SIGNED) - 1 AS bucket,
               ts,
               name,
               labels_hash AS labelsHash,
               labels,
               value,
               ROW_NUMBER() OVER (
                 PARTITION BY name, labels_hash, FLOOR(TIMESTAMPDIFF(SECOND, ${anchor}, ts) / ${bucketSec})
                 ORDER BY ts DESC, id DESC
               ) AS rn
          FROM metric_sample
         WHERE service = ${service}
           AND name IN (${Prisma.join([...names])})
           AND ${seriesClause(series)}
           AND ts >= ${from}
           AND ts <  ${to}
      ) ranked
     WHERE ranked.rn = 1`;

  return rows.map(toMetricRow);
}

/**
 * The same shape out of `metric_rollup`, whose `last` column is precisely the last raw reading of
 * its hour — so a counter difference taken across the seam is the same subtraction it would have
 * been against the raw rows, and the join loses nothing.
 *
 * Written out rather than sharing a builder with the function above: the two differ in table and
 * value column and nothing else, and the alternative is interpolating a table name into raw SQL,
 * which is the one thing this codebase keeps behind an allow-list (`MANAGED_TABLES`).
 */
async function rollupSamples(prisma: PrismaService, query: SampleQuery, window: TimeWindow): Promise<MetricRow[]> {
  const { service, from: origin, plan, names, series } = query;
  const { from, to } = window;
  const bucketSec = plan.bucketMs / 1000;
  const anchor = gridStart(origin, plan.bucketMs, -1);

  const rows = await prisma.$queryRaw<SampleRow[]>`
    SELECT /*+ MAX_EXECUTION_TIME(${Prisma.raw(String(SIGNALS_MAX_EXECUTION_MS))}) */
           bucket, ts, name, labelsHash, labels, value
      FROM (
        SELECT CAST(FLOOR(TIMESTAMPDIFF(SECOND, ${anchor}, ts) / ${bucketSec}) AS SIGNED) - 1 AS bucket,
               ts,
               name,
               labels_hash AS labelsHash,
               labels,
               last AS value,
               ROW_NUMBER() OVER (
                 PARTITION BY name, labels_hash, FLOOR(TIMESTAMPDIFF(SECOND, ${anchor}, ts) / ${bucketSec})
                 ORDER BY ts DESC, id DESC
               ) AS rn
          FROM metric_rollup
         WHERE service = ${service}
           AND name IN (${Prisma.join([...names])})
           AND ${seriesClause(series)}
           AND ts >= ${from}
           AND ts <  ${to}
      ) ranked
     WHERE ranked.rn = 1`;

  return rows.map(toMetricRow);
}

/**
 * `bucket` is a `BIGINT` out of the `CAST(… AS SIGNED)`, which the driver hands back as a `BigInt`
 * — a type that compares against nothing and throws on `JSON.stringify`. `value` is a `DOUBLE` and
 * is a number already; it goes through `Number` anyway so that one conversion covers the day the
 * rollup's column type is not the raw table's.
 */
const toMetricRow = (row: SampleRow): MetricRow => ({
  bucket: Number(row.bucket),
  // The instant, not the bucket: `elapsedOf` divides by the distance between two readings, and the
  // bucket index cannot say what that was.
  ts: row.ts.getTime(),
  name: row.name,
  series: row.labelsHash,
  labels: row.labels,
  value: Number(row.value),
});
