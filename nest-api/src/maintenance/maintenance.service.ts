import { logger } from "@common/logger";
import { PrismaService } from "@db/prisma.service";
import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { assertDayPartition, boundaryOf, DAYS_AHEAD, dateOf, FUTURE_PARTITION, plan } from "./partitions";

import type { OnApplicationBootstrap } from "@nestjs/common";

/** What one pass did, for the summary line and for the tests. */
export type MaintenanceReport = {
  created: string[];
  dropped: string[];
  durationMs: number;
};

/**
 * What `GET /api/collector/storage` serves (IKN-24), as ISO dates rather than partition names —
 * `p20260821` is an implementation detail of the table, `2026-08-21` is what the panel shows.
 *
 * A retention policy nobody can check from the interface is a retention policy nobody trusts,
 * which is the entire reason this exists rather than living only in a log line.
 */
export type StorageWindow = {
  retentionDays: number;
  /** The oldest day still held, `null` before the first successful pass. */
  oldestPartition: string | null;
  lastRunAt: Date | null;
};

/**
 * Keeps `log_entry` to a bounded, predictable size: three days of partitions ahead of today, and
 * nothing older than the retention window (IKN-11).
 *
 * Both halves are `ALTER TABLE`, and that is the whole design. Retention by `DROP PARTITION` is
 * instant and **returns the disk to the filesystem**, which a batched `DELETE` never does —
 * InnoDB keeps the freed pages for itself and the data file only ever grows.
 *
 * Nothing here is load-bearing for ingestion. If this job never runs, rows keep landing in
 * `p_future` and the only consequence is a table that is not pruned: degraded, not broken. That
 * is why every failure below is caught and logged rather than propagated — a maintenance job
 * that can crash the API at boot is a worse problem than the one it solves.
 */
@Injectable()
export class MaintenanceService implements OnApplicationBootstrap {
  private lastRunAt: Date | null = null;
  private oldest: string | null = null;
  /** One pass at a time: boot and the 3 a.m. cron can otherwise overlap and fight over the DDL. */
  private running: Promise<MaintenanceReport> | null = null;

  constructor(
    private readonly retentionDays: number,
    private readonly prisma: PrismaService,
    /**
     * Days of partitions kept ahead of today. Three in production — two missed runs still have
     * somewhere to put their rows — and widened by the tests that need the reorganisation of
     * `p_future` to reach a day they can write to.
     */
    private readonly daysAhead: number = DAYS_AHEAD,
  ) {}

  /** Once at boot, so a fresh deploy is correct immediately rather than at three tomorrow morning. */
  async onApplicationBootstrap(): Promise<void> {
    await this.safeRun();
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async daily(): Promise<void> {
    await this.safeRun();
  }

  window(): StorageWindow {
    return {
      retentionDays: this.retentionDays,
      oldestPartition: this.oldest,
      lastRunAt: this.lastRunAt,
    };
  }

  /**
   * The scheduled entry point. Swallows failures on purpose — see the class comment — but says
   * so loudly enough that the line is findable in Iknos itself.
   */
  private async safeRun(): Promise<void> {
    try {
      await this.run();
    } catch (error) {
      logger.error({ err: error }, "partition maintenance failed; ingestion continues into p_future");
    }
  }

  async run(): Promise<MaintenanceReport> {
    // A second caller waits for the pass in flight and reports the same result, rather than
    // issuing a REORGANIZE against a table another REORGANIZE is halfway through.
    if (this.running) return this.running;

    this.running = this.execute();
    try {
      return await this.running;
    } finally {
      this.running = null;
    }
  }

  private async execute(): Promise<MaintenanceReport> {
    const startedAt = Date.now();

    const rows = await this.prisma.$queryRaw<{ PARTITION_NAME: string }[]>`
      SELECT PARTITION_NAME FROM information_schema.PARTITIONS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'log_entry'
         AND PARTITION_NAME IS NOT NULL`;

    const existing = rows.map((r) => r.PARTITION_NAME);
    const { toCreate, toDrop } = plan(existing, new Date(), this.retentionDays, this.daysAhead);

    for (const name of toCreate) await this.create(name);
    for (const name of toDrop) await this.drop(name);

    const durationMs = Date.now() - startedAt;
    this.lastRunAt = new Date();
    this.oldest = oldestDay(existing, toCreate, toDrop);

    // The summary line the ticket asks for, and it is ingested like any other: this job's own
    // history is readable in the tool it maintains.
    logger.info(
      { created: toCreate, dropped: toDrop, durationMs, retentionDays: this.retentionDays, oldest: this.oldest },
      "partition maintenance",
    );

    return { created: toCreate, dropped: toDrop, durationMs };
  }

  /**
   * A RANGE partition can only be added at the end, and the end is `MAXVALUE`. So the day is
   * carved off the front of `p_future` instead — which also moves whatever rows had already
   * accumulated there into the partition they belong in, at no cost once the window is being
   * kept, because in steady state `p_future` is empty.
   */
  private async create(name: string): Promise<void> {
    assertDayPartition(name);
    await this.prisma.$executeRawUnsafe(
      `ALTER TABLE log_entry REORGANIZE PARTITION ${FUTURE_PARTITION} INTO (` +
        `PARTITION ${name} VALUES LESS THAN (TO_DAYS('${boundaryOf(name)}')), ` +
        `PARTITION ${FUTURE_PARTITION} VALUES LESS THAN MAXVALUE)`,
    );
  }

  private async drop(name: string): Promise<void> {
    assertDayPartition(name);
    await this.prisma.$executeRawUnsafe(`ALTER TABLE log_entry DROP PARTITION ${name}`);
  }
}

/**
 * The oldest day the table still holds, as an ISO date.
 *
 * Computed from the plan rather than by asking MySQL a second time: the answer is already known
 * once the pass is done, and one round trip is not worth spending on a number that is about to be
 * displayed next to a fourteen-day window.
 */
function oldestDay(existing: string[], created: string[], dropped: string[]): string | null {
  const kept = [...existing, ...created]
    .filter((name) => !dropped.includes(name))
    .map(dateOf)
    .filter((date): date is Date => date !== null)
    .sort((a, b) => +a - +b);

  return kept[0]?.toISOString().slice(0, 10) ?? null;
}
