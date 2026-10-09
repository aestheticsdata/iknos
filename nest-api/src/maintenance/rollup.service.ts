import { logger } from "@common/logger";
import { PrismaService } from "@db/prisma.service";
import { Prisma } from "@generated/prisma/client";
import { Injectable } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { dayChunks, type HourRange, pendingHours } from "./rollup-plan";

/**
 * Hourly aggregates of `metric_sample` into `metric_rollup` (IKN-20).
 *
 * Raw samples live three days; the range selector reaches a week, and the long history is what
 * this keeps — one row per series per hour (`count`, `sum`, `min`, `max`, `last`) instead of the
 * hundred-odd readings the hour was scraped as. About 1 % of the raw size, so it can be kept for
 * 90 days (`IKNOS_ROLLUP_RETENTION_DAYS`) — ~550 MB on ks-b.
 *
 * **A rollup's `ts` is its hour's last reading, not the top of the hour.** `last` is the counter's
 * value at that reading, and the readers difference consecutive `last`s and divide by the time
 * between their `ts` — exactly as they do raw rows. Stamped at `10:00`, a reading taken at
 * `10:59:45` would land a bucket early on any grid not aligned to the clock hour, and the first raw
 * interval after the seam would be divided by an hour too many. Stamped where it was read, the two
 * tables are the same kind of row and the seam is invisible.
 *
 * **Idempotent by construction.** Each pass deletes the rollups of the hours it is about to write
 * and inserts them again, in one transaction: replaying an hour rewrites it identically, and an
 * hour that gained a late row is corrected rather than duplicated.
 *
 * **Before any purge.** `MaintenanceService` calls `catchUp` before dropping a `metric_sample`
 * partition and keeps any day this has not finished — a purge ahead of its rollup would be a
 * permanent hole in every long chart.
 *
 * In SQL, never in memory: an hour of raw samples is a few hundred thousand rows, and the event loop
 * is the API's.
 */

/** What one pass did, for the log line and the tests. */
export type RollupReport = {
  /** The end of the last hour aggregated — everything before it is rolled up. */
  through: Date | null;
  hours: number;
  rows: number;
  durationMs: number;
};

/** Narrows a pass to one service — the tests' only way of not rewriting a developer's whole DB. */
export type RollupScope = {
  service?: string;
};

@Injectable()
export class RollupService {
  /** One pass at a time: the boot pass, the hourly cron and the 3 a.m. purge can all ask at once. */
  private running: Promise<RollupReport> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    /** `IKNOS_METRIC_RETENTION_DAYS` — how far back raw samples can still be aggregated. */
    private readonly rawWindowDays: number,
  ) {}

  /**
   * The boot catch-up, started by `MaintenanceService` once its own boot pass is done — never
   * alongside it. After a stop this is a few day-sized transactions writing into `metric_rollup`,
   * and the boot pass's `REORGANIZE` of that table waits for any open one: started side by side on
   * 2026-10-09, the DDL queued behind a three-day catch-up, the boot never finished, and the deploy
   * rolled itself back on a silent `/health`. In the background, after, it holds nothing up.
   */
  catchUpInBackground(): void {
    void this.safeCatchUp();
  }

  /** `:07`, the minute the storage panel already announces (`hourly rollup +00:07`). */
  @Cron("7 * * * *")
  async hourly(): Promise<void> {
    await this.safeCatchUp();
  }

  /**
   * Every complete hour not yet aggregated, up to now. Resolves with what was done; a failure is
   * thrown, because the purge needs to know it happened.
   */
  catchUp(now: Date = new Date()): Promise<RollupReport> {
    if (this.running) return this.running;

    this.running = this.execute(now).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** The scheduled entry points log a failure and carry on — the API outlives its maintenance. */
  private async safeCatchUp(): Promise<void> {
    try {
      await this.catchUp();
    } catch (error) {
      logger.error({ err: error }, "metric rollup failed; raw partitions will be kept until it succeeds");
    }
  }

  private async execute(now: Date): Promise<RollupReport> {
    const startedAt = Date.now();
    const range = pendingHours({ newest: await this.newest(now), now, rawWindowDays: this.rawWindowDays });

    if (range === null) {
      return { through: await this.through(now), hours: 0, rows: 0, durationMs: Date.now() - startedAt };
    }

    let rows = 0;
    for (const chunk of dayChunks(range)) rows += await this.roll(chunk);

    const report = {
      through: range.to,
      hours: (+range.to - +range.from) / 3_600_000,
      rows,
      durationMs: Date.now() - startedAt,
    };
    logger.info(
      { from: range.from, to: range.to, hours: report.hours, rows, durationMs: report.durationMs },
      "metric rollup",
    );
    return report;
  }

  /**
   * Aggregates the hours of one chunk — every series, or one service's — replacing whatever
   * rollups those hours already had.
   *
   * `last` is the value of the highest `id` in the hour, the property IKN-66 pinned for the raw
   * table: ids rise with `ts` within a series because the collector writes each scrape as it
   * happens. The `ts` range is repeated on the join so the lookup stays inside the chunk's
   * partition rather than probing every day for an id.
   */
  async roll(chunk: HourRange, scope: RollupScope = {}): Promise<number> {
    const { from, to } = chunk;
    const onlyService = scope.service ?? null;

    const [, inserted] = await this.prisma.$transaction(
      [
        this.prisma.$executeRaw`
        DELETE FROM metric_rollup
         WHERE ts >= ${from} AND ts < ${to}
           AND (${onlyService} IS NULL OR service = ${onlyService})`,
        this.prisma.$executeRaw`
        INSERT INTO metric_rollup (ts, service, name, labels, labels_hash, count, sum, min, max, last)
        SELECT m.ts, g.service, g.name, m.labels, g.labels_hash, g.c, g.s, g.mn, g.mx, m.value
          FROM (
            SELECT service,
                   name,
                   labels_hash,
                   FLOOR(TIMESTAMPDIFF(SECOND, ${from}, ts) / 3600) AS hour,
                   COUNT(*)   AS c,
                   SUM(value) AS s,
                   MIN(value) AS mn,
                   MAX(value) AS mx,
                   MAX(id)    AS lid
              FROM metric_sample
             WHERE ts >= ${from} AND ts < ${to}
               AND (${onlyService} IS NULL OR service = ${onlyService})
             GROUP BY service, name, labels_hash, hour
          ) g
          JOIN metric_sample m
            ON m.id = g.lid
           AND m.ts >= ${from}
           AND m.ts <  ${to}`,
      ],
      /*
       * `READ COMMITTED`, not MySQL's default. Under `REPEATABLE READ` an `INSERT … SELECT` takes
       * shared next-key locks on every row it reads, and a day of `metric_sample` read that way
       * would hold the collector's next scrape until the scan finished. Read committed reads a
       * snapshot and locks nothing in the source; the rollup is no less correct for it, since the
       * hours it reads are finished ones nobody writes to any more.
       */
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );

    return inserted;
  }

  /**
   * The newest rollup's `ts`, looked for only where it can usefully be: a rollup older than the raw
   * window changes nothing about where the next pass starts, and bounding the search is what lets
   * MySQL prune the table to its last few days instead of reading ninety days of it.
   */
  private async newest(now: Date): Promise<Date | null> {
    const since = new Date(+now - (this.rawWindowDays + 1) * 86_400_000);
    const [row] = await this.prisma.$queryRaw<{ ts: Date | null }[]>`
      SELECT MAX(ts) AS ts FROM metric_rollup WHERE ts >= ${since}`;
    return row?.ts ?? null;
  }

  /** With nothing owed, everything up to the last finished hour is already rolled up. */
  private async through(now: Date): Promise<Date | null> {
    const newest = await this.newest(now);
    return newest === null ? null : new Date((Math.floor(+newest / 3_600_000) + 1) * 3_600_000);
  }
}
