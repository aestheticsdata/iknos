import { logger } from "@common/logger";
import { PrismaService } from "@db/prisma.service";
import { Injectable } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";

import type { BeforeApplicationShutdown, OnApplicationBootstrap } from "@nestjs/common";
import type { ContentPurgeReport } from "./interfaces/content-purge-types";

/** Rows one `DELETE` removes: small enough that no statement holds its locks for long. */
export const PURGE_BATCH_ROWS = 5000;

/** Batches one pass may run — 500 000 rows; a backlog past that is the next hour's. */
export const PURGE_MAX_BATCHES = 100;

/** When the hourly purge runs, in words — `:17`, clear of the rollup's `:07`. */
export const CONTENT_PURGE_AT = "hourly +00:17";

/**
 * Deletes OTLP span content whose retention has run out (IKN-87 v2).
 *
 * `span_content` holds what a person typed and a model wrote — the part of a trace with a shorter,
 * sender-stated lifetime than its metadata. Each row carries its own `expires_at`; this deletes
 * the rows past it, and nothing else: the `span` and `span_event` rows they came from stay for
 * the log window, and still read back, now marked "content expired".
 *
 * **A `DELETE`, not a `DROP PARTITION`**, unlike `MaintenanceService`: the lifetime is per batch,
 * not per day, so no partition boundary lines up with what has to go. Bounded batches through the
 * `expires_at` index instead, oldest first, each its own short statement, so the table is never
 * locked for the length of a backlog.
 *
 * Hourly, and once at boot in the background — the fleet is stopped overnight on ks-b, so a 3 a.m.
 * job would not run (see `MaintenanceService.onApplicationBootstrap`), and an hour's granularity on
 * a retention counted in days keeps the promise to within an hour. The read side does not wait for
 * it either way: content past `expires_at` is never read (`TracesService.spans`).
 */
@Injectable()
export class ContentPurgeService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private running: Promise<ContentPurgeReport> | null = null;
  private stopping = false;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    void this.safePurge();
  }

  /** A pass in progress stops after its current batch, so a reload never waits on a backlog. */
  beforeApplicationShutdown(): void {
    this.stopping = true;
  }

  @Cron("17 * * * *")
  async hourly(): Promise<void> {
    await this.safePurge();
  }

  /** One pass; a second caller joins the one in flight rather than racing it over the same rows. */
  purge(now: Date = new Date()): Promise<ContentPurgeReport> {
    if (this.running) return this.running;

    this.running = this.execute(now).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** The scheduled entry points log a failure and carry on — expired content waits an hour more. */
  private async safePurge(): Promise<void> {
    try {
      await this.purge();
    } catch (error) {
      logger.error({ err: error }, "span content purge failed; expired content stays unread until the next pass");
    }
  }

  private async execute(now: Date): Promise<ContentPurgeReport> {
    const startedAt = Date.now();
    let deleted = 0;
    let batches = 0;

    while (batches < PURGE_MAX_BATCHES && !this.stopping) {
      const removed = await this.prisma.$executeRaw`
        DELETE FROM span_content WHERE expires_at <= ${now} ORDER BY expires_at LIMIT ${PURGE_BATCH_ROWS}`;
      batches += 1;
      deleted += removed;
      if (removed < PURGE_BATCH_ROWS) break;
    }

    const report: ContentPurgeReport = { deleted, batches, durationMs: Date.now() - startedAt };
    // Ingested like every other line of the API, so the purge's own history is readable in Iknos.
    logger.info(report, "span content purge");
    return report;
  }
}
