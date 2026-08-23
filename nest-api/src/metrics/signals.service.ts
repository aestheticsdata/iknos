import { PrismaService } from "@db/prisma.service";
import { Prisma } from "@generated/prisma/client";
import { Injectable } from "@nestjs/common";
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
    const [rollupRows, rawRows] = await Promise.all([
      windows.rollup ? this.rollupSamples(service, from, plan, windows.rollup.from, windows.rollup.to) : [],
      windows.raw ? this.rawSamples(service, from, plan, windows.raw.from, windows.raw.to) : [],
    ]);

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
      SELECT bucket, ts, name, labelsHash, labels, value
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
      SELECT bucket, ts, name, labelsHash, labels, value
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
