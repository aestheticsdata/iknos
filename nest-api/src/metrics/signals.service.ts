import { PrismaService } from "@db/prisma.service";
import { Prisma } from "@generated/prisma/client";
import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { gridStart, planSource, windowsFor } from "./metric-window";
import { buildSignals, METRIC_NAMES, type MetricRow } from "./signal-series";

import type { ServiceSignals } from "@contracts/service-signals";
import type { SourcePlan } from "./metric-window";

/**
 * The queries behind the service view's first three tiles (IKN-13).
 *
 * Everything that decides what a number *means* lives in `signal-series.ts`, `counter-rate.ts` and
 * `histogram-quantile.ts`, which are pure and tested against worked examples. What is left in here
 * is the part a reader can check by eye: two range scans, cut on a bucket boundary, both returning
 * the last reading of every series in every interval.
 */

type SampleRow = {
  bucket: bigint | number;
  ts: Date;
  name: string;
  labelsHash: string;
  labels: unknown;
  value: number;
};

export type SignalsResult = Omit<ServiceSignals, "service" | "scraped" | "meta">;

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
const isExecutionTimeout = (err: unknown): boolean =>
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

@Injectable()
export class SignalsService {
  constructor(
    private readonly prisma: PrismaService,
    /** `IKNOS_METRIC_RETENTION_DAYS` — how far back raw samples can be relied on. */
    private readonly rawWindowDays: number,
  ) {}

  async signals(service: string, from: Date, to: Date, now: Date = new Date()): Promise<SignalsResult> {
    const plan = planSource(from, to, now, this.rawWindowDays);
    const windows = windowsFor(from, to, plan);

    /*
     * At most one round trip per source, and all three metrics in each.
     *
     * The window function picks the last reading of every series in every interval, which is the
     * only reading a counter difference is allowed to be taken from.
     *
     * **What bounds this is the partition pruning, not the index.** `EXPLAIN` on a narrow window
     * takes `(service, name, labels_hash, ts)`, and on a wide one the optimiser costs a scan of the
     * pruned partitions lower and takes that instead — the index covers neither `labels` nor
     * `value`, so every match needs the row anyway. Forcing it measured no better at `7d` (≈2.5 s
     * either way) and only helped at `15m`, because the cost past a certain width is the sort of
     * the qualifying rows rather than the way they were found. The answer to that is `metric_rollup`
     * (IKN-20), which is why wide ranges are meant to stop reading this table at all.
     */
    let rollupRows: MetricRow[];
    let rawRows: MetricRow[];
    try {
      [rollupRows, rawRows] = await Promise.all([
        windows.rollup ? this.rollupSamples(service, from, plan, windows.rollup.from, windows.rollup.to) : [],
        windows.raw ? this.rawSamples(service, from, plan, windows.raw.from, windows.raw.to) : [],
      ]);
    } catch (err) {
      if (isExecutionTimeout(err)) throw new ServiceUnavailableException(SIGNALS_TOO_SLOW);
      throw err;
    }

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      bucketMs: plan.bucketMs,
      source: plan.source,
      ...buildSignals([...rollupRows, ...rawRows], from, plan),
    };
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
  private async rawSamples(
    service: string,
    origin: Date,
    plan: SourcePlan,
    from: Date,
    to: Date,
  ): Promise<MetricRow[]> {
    const bucketSec = plan.bucketMs / 1000;
    const anchor = gridStart(origin, plan.bucketMs, -1);

    const rows = await this.prisma.$queryRaw<SampleRow[]>`
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
             AND name IN (${Prisma.join([...METRIC_NAMES])})
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
   * Written out rather than sharing a builder with the method above: the two differ in table and
   * value column and nothing else, and the alternative is interpolating a table name into raw SQL,
   * which is the one thing this codebase keeps behind an allow-list (`MANAGED_TABLES`).
   */
  private async rollupSamples(
    service: string,
    origin: Date,
    plan: SourcePlan,
    from: Date,
    to: Date,
  ): Promise<MetricRow[]> {
    const bucketSec = plan.bucketMs / 1000;
    const anchor = gridStart(origin, plan.bucketMs, -1);

    const rows = await this.prisma.$queryRaw<SampleRow[]>`
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
             AND name IN (${Prisma.join([...METRIC_NAMES])})
             AND ts >= ${from}
             AND ts <  ${to}
        ) ranked
       WHERE ranked.rn = 1`;

    return rows.map(toMetricRow);
  }
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
