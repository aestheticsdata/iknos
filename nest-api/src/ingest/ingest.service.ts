import { logger } from "@common/logger";
import { PrismaService } from "@db/prisma.service";
import { Injectable } from "@nestjs/common";
import { LogBus } from "@stream/log-bus";
import { Tailer } from "./tailer";
import { FLUSH_INTERVAL_MS, persistBatch, Writer } from "./writer";

import type { OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import type { RateSnapshot } from "./rate-window";

const POLL_INTERVAL_MS = 1000;

/**
 * The snapshot `GET /api/collector/status` serves (IKN-24). Assembled from objects this service
 * already holds, and **never from a database query**: a status route that asks MySQL how
 * ingestion is doing goes silent exactly when MySQL is the problem — the one moment anybody
 * looks at it.
 */
export type IngestStats = {
  written: number;
  dropped: number;
  degraded: number;
  queued: number;
  bytesRead: number;
  lagMs: number | null;
  lastWrittenAt: Date | null;
  /** The tailer's heartbeat — see `Tailer.lastPollAt`. */
  lastPollAt: Date | null;
  /** The last hour of throughput, or `null` before the first line landed. */
  rate: RateSnapshot | null;
  files: { filePath: string; byteOffset: number }[];
};

/**
 * Owns the collector's lifecycle: hydrate the offsets, drive the tailer and the writer on their
 * intervals, and drain on shutdown. The pieces themselves stay ignorant of Nest — the tailer and
 * writer are plain classes with their own tests, and this is the only file that knows they run
 * inside an application.
 */
@Injectable()
export class IngestService implements OnApplicationBootstrap, OnApplicationShutdown {
  private writer!: Writer;
  private tailer!: Tailer;
  private timers: NodeJS.Timeout[] = [];
  private polling = false;
  private readonly offsets = new Map<string, bigint>();

  constructor(
    private readonly pattern: string,
    private readonly bus: LogBus,
    private readonly prisma: PrismaService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.writer = new Writer({ persist: (records, offsets) => persistBatch(this.prisma, records, offsets) }, this.bus);
    this.tailer = new Tailer(this.pattern, (chunk) => {
      this.writer.submit(chunk);
      this.offsets.set(chunk.offset.filePath, chunk.offset.byteOffset);
    });

    // The stored positions are the other half of no-loss-no-duplicate: whatever the last
    // committed transaction accounted for is where reading resumes.
    const stored = await this.prisma.ingestOffset.findMany();
    this.tailer.hydrate(stored);
    for (const o of stored) this.offsets.set(o.filePath, o.byteOffset);

    this.timers.push(
      setInterval(() => void this.tick(), POLL_INTERVAL_MS),
      setInterval(() => void this.flushSafely(), FLUSH_INTERVAL_MS),
    );
  }

  /**
   * Detection is stat-on-an-interval, not fs.watch: watch APIs are unreliable across
   * filesystems and gain nothing at one second.
   */
  private async tick(): Promise<void> {
    // Never let two polls overlap. A slow disk would otherwise stack them until the event loop
    // — shared with the API — stops answering.
    if (this.polling) return;
    this.polling = true;
    try {
      await this.tailer.poll();
    } catch (err) {
      logger.error({ err }, "tailer poll failed");
    } finally {
      this.polling = false;
    }
  }

  private async flushSafely(): Promise<void> {
    try {
      await this.writer.flush();
    } catch (err) {
      // flush() handles its own database failures; this catches everything else so an interval
      // callback can never become an unhandled rejection that kills the process.
      logger.error({ err }, "flush failed");
    }
  }

  /**
   * Answers before `onApplicationBootstrap` has run, and that is not a theoretical case: Nest
   * serves requests the moment the HTTP adapter is listening, and a browser reloading during a
   * deploy lands there. Reading `this.writer.written` on an unassigned field would throw a 500
   * from the one route whose job is to say what state the collector is in.
   */
  stats(): IngestStats {
    if (!this.writer || !this.tailer) {
      return {
        written: 0,
        dropped: 0,
        degraded: 0,
        queued: 0,
        bytesRead: 0,
        lagMs: null,
        lastWrittenAt: null,
        lastPollAt: null,
        rate: null,
        files: [],
      };
    }

    return {
      written: this.writer.written,
      dropped: this.writer.dropped,
      degraded: this.writer.degraded,
      queued: this.writer.queuedRecords,
      bytesRead: this.tailer.bytesRead,
      lagMs: this.writer.lagMs,
      lastWrittenAt: this.writer.lastWrittenAt,
      lastPollAt: this.tailer.lastPollAt,
      rate: this.writer.rate.snapshot(Date.now()),
      files: [...this.offsets.entries()].map(([filePath, byteOffset]) => ({
        filePath,
        byteOffset: Number(byteOffset),
      })),
    };
  }

  async onApplicationShutdown(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    // One last drain, so a clean shutdown ships what the queue still holds instead of leaving it
    // for the restart to re-read.
    await this.writer.flush();
  }
}
