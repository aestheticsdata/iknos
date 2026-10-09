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
 * `metric_sample`, by far the largest table here. On 2026-08-25 a scan reached 23 s p50 while the
 * service view polls every `SIGNALS_POLL_MS` (30 s), so each poll opened a new scan before the
 * last had finished. Ten of those is the whole pool, and the API answered nothing at all — not the
 * log panel, not the rail, not `/api/services`, none of which read this table.
 *
 * `MAX_EXECUTION_TIME` makes MySQL itself end the statement, which is the only cancellation that
 * exists here: aborting the HTTP request does not stop the query, and the connection stays
 * checked out until the server is done regardless of who is still listening. Capped below the
 * pool's own patience, a connection is always returned before a waiter gives up, so this endpoint
 * can no longer be the reason an unrelated one fails.
 *
 * It is a ceiling, not a target. A signals scan that needs eight seconds is already useless — the
 * tile it feeds is refetched every thirty — so the range that trips this is one nobody could read
 * anyway. It is not memory: `innodb_buffer_pool_size` has been 4 GB on ks-b since 2026-08-25 and
 * the data sits in RAM. What made `24h` trip it was the sort behind a window function, gone with
 * IKN-66; what still can is a range past the raw retention, which is `metric_rollup`'s (IKN-20).
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
 * construction, or as good as: it trips on a range wider than these scans can serve, which a
 * narrower range answers.
 */
export const SIGNALS_TOO_SLOW = "the metrics query exceeded its time budget — narrow the range";

/**
 * Every row the plan calls for, from whichever tables it names.
 *
 * At most one round trip per source. A scan MySQL ended on its time budget becomes a 503 here, for
 * every caller at once — see `SIGNALS_TOO_SLOW` for why it is never an empty answer.
 */
export async function readSamples(prisma: PrismaService, query: SampleQuery): Promise<MetricRow[]> {
  const windows = windowsFor(query.from, query.to, query.plan);

  /*
   * Each scan keeps the last reading of every series in every interval, which is the only reading
   * a counter difference is allowed to be taken from.
   *
   * What these cost is the rows that qualify, not the way they are found. The window function this
   * replaced sorted every one of them — 1.73 M for `pfa-nest-api` at `24h`, 61 s of sort — and no
   * index changed that, which is why forcing `(service, name, labels_hash, ts)` was once measured
   * no better. The grouping now aggregates them instead and reads the full row only for the ones
   * kept (IKN-66). Partition pruning on `ts` is still what bounds the scan itself.
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
 * rather than into the priming bucket `-1` — verified in MySQL, not deduced. The grouping below
 * then prefers a later reading in that bucket and the priming value is discarded, which
 * leaves the first interval of the chart with no predecessor to be differenced against and
 * therefore blank, for about one scrape in fifteen. Measuring from the priming interval's own
 * start makes every difference non-negative, where truncation and flooring are the same thing.
 *
 * **`MAX(id)`, not a window function (IKN-66).** "The last reading of each series in each
 * interval" was a `ROW_NUMBER() OVER (… ORDER BY ts DESC, id DESC)`, and on ks-b at `24h` that is a
 * sort of 1.73 M rows to keep 8 900 — 61 s of a 70 s statement, against a ceiling of 8. Grouping to
 * the key and taking the highest id is an aggregation over the 8 900 groups, and `labels` and
 * `value` are then read for the survivors only, through the primary key.
 *
 * The two agree because `id` rises with `ts` inside a series: it is auto-increment, the collector
 * writes each scrape as it happens, and every row of one scrape carries the same `ts`. That is the
 * one property this rests on, and `metric-samples.e2e-spec.ts` holds it against the old shape.
 *
 * The `ts` predicate is not politeness: `metric_sample` is partitioned by day, and it is what
 * discards whole partitions before a row is read. It is repeated on the join for the same reason —
 * the primary key is `(id, ts)`, and an `id` alone would be looked up in every partition.
 */
async function rawSamples(prisma: PrismaService, query: SampleQuery, window: TimeWindow): Promise<MetricRow[]> {
  const { service, from: origin, plan, names, series } = query;
  const { from, to } = window;
  const bucketSec = plan.bucketMs / 1000;
  const anchor = gridStart(origin, plan.bucketMs, -1);

  const rows = await prisma.$queryRaw<SampleRow[]>`
    SELECT /*+ MAX_EXECUTION_TIME(${Prisma.raw(String(SIGNALS_MAX_EXECUTION_MS))}) */
           k.b - 1 AS bucket,
           m.ts,
           m.name,
           m.labels_hash AS labelsHash,
           m.labels,
           m.value
      FROM (
        SELECT MAX(id) AS id,
               CAST(FLOOR(TIMESTAMPDIFF(SECOND, ${anchor}, ts) / ${bucketSec}) AS SIGNED) AS b
          FROM metric_sample
         WHERE service = ${service}
           AND name IN (${Prisma.join([...names])})
           AND ${seriesClause(series)}
           AND ts >= ${from}
           AND ts <  ${to}
         GROUP BY name, labels_hash, b
      ) k
      JOIN metric_sample m
        ON m.id = k.id
       AND m.ts >= ${from}
       AND m.ts <  ${to}`;

  return rows.map(toMetricRow);
}

/**
 * The same shape out of `metric_rollup`, whose `last` column is precisely the last raw reading of
 * its hour — so a counter difference taken across the seam is the same subtraction it would have
 * been against the raw rows, and the join loses nothing.
 *
 * **`MAX(ts)` here, not `MAX(id)`.** A rollup row is written by a job, and a job that backfills a
 * missed hour writes an older `ts` under a newer `id` — the property the raw query rests on does
 * not hold for this table. `(service, name, labels_hash, ts)` is unique, so the latest `ts` of a
 * group names exactly one row, whatever order the rows were written in.
 *
 * Written out rather than sharing a builder with the function above: the two differ in table, key
 * and value column, and the alternative is interpolating a table name into raw SQL, which is the
 * one thing this codebase keeps behind an allow-list (`MANAGED_TABLES`).
 */
async function rollupSamples(prisma: PrismaService, query: SampleQuery, window: TimeWindow): Promise<MetricRow[]> {
  const { service, from: origin, plan, names, series } = query;
  const { from, to } = window;
  const bucketSec = plan.bucketMs / 1000;
  const anchor = gridStart(origin, plan.bucketMs, -1);

  const rows = await prisma.$queryRaw<SampleRow[]>`
    SELECT /*+ MAX_EXECUTION_TIME(${Prisma.raw(String(SIGNALS_MAX_EXECUTION_MS))}) */
           k.b - 1 AS bucket,
           r.ts,
           r.name,
           r.labels_hash AS labelsHash,
           r.labels,
           r.last AS value
      FROM (
        SELECT name,
               labels_hash,
               MAX(ts) AS ts,
               CAST(FLOOR(TIMESTAMPDIFF(SECOND, ${anchor}, ts) / ${bucketSec}) AS SIGNED) AS b
          FROM metric_rollup
         WHERE service = ${service}
           AND name IN (${Prisma.join([...names])})
           AND ${seriesClause(series)}
           AND ts >= ${from}
           AND ts <  ${to}
         GROUP BY name, labels_hash, b
      ) k
      JOIN metric_rollup r
        ON r.service = ${service}
       AND r.name = k.name
       AND r.labels_hash = k.labels_hash
       AND r.ts = k.ts`;

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
