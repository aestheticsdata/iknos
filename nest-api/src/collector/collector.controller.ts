import { IngestService } from "@ingest/ingest.service";
import { Controller, Get } from "@nestjs/common";
import { StorageService } from "./storage.service";

import type { CollectorStatus, CollectorStorage } from "@contracts/collector";

/**
 * Iknos, observing itself (IKN-24).
 *
 * Both routes sit behind the global session guard like everything else — there is no `@Public()`
 * here. The list of files being tailed and the byte offsets in them describe the host's layout,
 * and the ingest volume describes how busy it is; neither is anybody's business unsigned-in.
 */
@Controller("api/collector")
export class CollectorController {
  constructor(
    private readonly ingest: IngestService,
    private readonly storage: StorageService,
  ) {}

  /**
   * **Never touches the database.** Every number below is read out of the collector's own memory,
   * which is the whole reason this route can be believed: a status endpoint that asks MySQL how
   * ingestion is doing hangs or 500s at exactly the moment somebody is asking it whether
   * ingestion is doing anything.
   *
   * The cost is that a restart resets the counters, which the payload does not hide — `rate` and
   * `lagMs` come back `null` rather than zero until there is something real to report.
   */
  @Get("status")
  status(): CollectorStatus {
    const startedAt = performance.now();
    const stats = this.ingest.stats();

    return {
      lagMs: stats.lagMs,
      lastWrittenAt: stats.lastWrittenAt?.toISOString() ?? null,
      lastPollAt: stats.lastPollAt?.toISOString() ?? null,
      written: stats.written,
      dropped: stats.dropped,
      degraded: stats.degraded,
      queued: stats.queued,
      bytesRead: stats.bytesRead,
      rate:
        stats.rate === null ? null : { perMinute: stats.rate.lines, lines: stats.rate.total, bytes: stats.rate.bytes },
      files: stats.files,
      observedAt: new Date().toISOString(),
      meta: { tookMs: Math.round(performance.now() - startedAt) },
    };
  }

  /**
   * The one route here that does query MySQL, and the one that is cached for it — see
   * `StorageService`. `tookMs` therefore reads as near-zero on a cache hit, which is accurate:
   * that is what the request cost. How old the reading is, is `computedAt`'s job.
   */
  @Get("storage")
  async storageUsage(): Promise<CollectorStorage> {
    const startedAt = performance.now();
    const snapshot = await this.storage.read();

    return { ...snapshot, meta: { tookMs: Math.round(performance.now() - startedAt) } };
  }
}
