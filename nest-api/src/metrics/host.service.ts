import { HOST_SAMPLE_FRESH_MS } from "@alerts/thresholds";
import { PrismaService } from "@db/prisma.service";
import { chooseBucketMs } from "@logs/histogram.service";
import { Injectable } from "@nestjs/common";
import { fillHostSeries, toReading } from "./host-series";
import { MIN_METRIC_BUCKET_MS } from "./metric-window";

import type { HostReading } from "@contracts/host";
import type { HostBucketRow, HostSampleRow, HostSeriesPoints } from "./interfaces/host-types";
import type { TimeWindow } from "./metric-samples";

/**
 * The two reads behind the machine panel (IKN-25). What the numbers mean lives in
 * `host-series.ts`; this file only asks MySQL for them.
 *
 * `host_sample` is one row every 30 s and is purged at the metric retention, so even a `7d` range
 * is a few thousand rows on an index over `ts` — no rollups and no execution ceiling, unlike
 * `metric_sample`, which runs to millions of rows a day.
 */
@Injectable()
export class HostService {
  constructor(private readonly prisma: PrismaService) {}

  /** The newest sample inside the freshness window — the same window the disk rule reads. */
  async now(cores: number, now: Date = new Date()): Promise<HostReading | null> {
    const row = await this.prisma.hostSample.findFirst({
      where: { ts: { gte: new Date(+now - HOST_SAMPLE_FRESH_MS) } },
      orderBy: { ts: "desc" },
    });

    return row === null ? null : toReading(row as HostSampleRow, cores);
  }

  /**
   * Every interval of the range, on the grid the service signals use.
   *
   * Floored at a minute for the reason `MIN_METRIC_BUCKET_MS` gives: at a 30 s cadence a narrower
   * interval is emptied by jitter alone, and every empty one reads as the sampler having stopped.
   *
   * Memory and CPU are **means** over the interval; disk is the **peak**. A disk that touched the
   * critical line for one sample did touch it, and averaging it away would draw a calm line under
   * an alert that fired.
   */
  async series(window: TimeWindow): Promise<HostSeriesPoints> {
    const { from, to } = window;
    const bucketMs = Math.max(chooseBucketMs(+from, +to), MIN_METRIC_BUCKET_MS);
    const buckets = Math.max(1, Math.ceil((+to - +from) / bucketMs));

    // `CAST(… AS DOUBLE)` on every aggregate: a ratio of two `BIGINT`s is a `DECIMAL`, which the
    // driver hands back as an object that serialises to `{}`.
    const rows = await this.prisma.$queryRaw<HostBucketRow[]>`
      SELECT CAST(FLOOR(TIMESTAMPDIFF(SECOND, ${from}, ts) / ${bucketMs / 1000}) AS SIGNED) AS bucket,
             CAST(AVG(cpu_pct) AS DOUBLE) AS cpu,
             CAST(AVG(mem_used_bytes / NULLIF(mem_total_bytes, 0)) * 100 AS DOUBLE) AS memory,
             CAST(MAX(disk_used_bytes / NULLIF(disk_total_bytes, 0)) * 100 AS DOUBLE) AS disk,
             CAST(AVG(load1) AS DOUBLE) AS \`load\`
        FROM host_sample
       WHERE ts >= ${from} AND ts < ${to}
       GROUP BY bucket
       ORDER BY bucket`;

    return fillHostSeries(rows, { from, bucketMs, buckets });
  }
}
