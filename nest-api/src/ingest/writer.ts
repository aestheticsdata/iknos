import { INGEST_SKIP_MARKER } from "../common/logger";

import type { PrismaService } from "../prisma/prisma.service";
import type { LogRecord } from "./log-record";

const MAX_ROWS_PER_FLUSH = 200;
export const FLUSH_INTERVAL_MS = 500;

/**
 * The ceiling that keeps a log burst from becoming an OOM. Node has no bounded channel to lean
 * on, so this is checked by hand on every push — losing log lines beats taking the host down
 * with MySQL behind it.
 */
export const MAX_QUEUED_RECORDS = 20_000;

export type OffsetRow = { filePath: string; dev: bigint; inode: bigint; byteOffset: bigint };

/** What the tailer hands over: records and the offset that accounts for exactly them. */
export type Chunk = { records: LogRecord[]; offset: OffsetRow };

/** The one method the writer needs from the live tail. `LogBus` satisfies it structurally. */
export type RecordSink = { emit: (record: LogRecord) => void };

/**
 * Column bounds, enforced at the writing edge.
 *
 * The parser caps a line at 1 MB, but TEXT holds 64 KB and the VARCHARs much less — and MySQL in
 * strict mode fails the whole INSERT on overflow. An unclamped hostile line would poison its
 * batch: the transaction fails, the chunk is retried, and one malformed line in one app becomes a
 * permanent ingestion outage for all of them. Clamped, the only failures left are connectivity,
 * which are exactly the ones safe to retry.
 */
const MAX_MESSAGE_BYTES = 60_000;

const clamp = (value: string | null, max: number): string | null =>
  value !== null && value.length > max ? value.slice(0, max) : value;

function clampMessage(message: string): string {
  if (Buffer.byteLength(message) <= MAX_MESSAGE_BYTES) return message;
  // Cut on bytes, then drop the replacement char a mid-codepoint cut leaves behind.
  return Buffer.from(message).subarray(0, MAX_MESSAGE_BYTES).toString("utf8").replace(/�+$/, "");
}

/** SMALLINT bounds. A "status code" outside them was never a status code. */
const inSmallInt = (value: number | null): number | null =>
  value !== null && value >= -32_768 && value <= 32_767 ? value : null;

const INT32_MAX = 2_147_483_647;

function toRow(r: LogRecord) {
  return {
    ts: r.ts,
    service: clamp(r.service, 64) as string,
    level: r.level,
    levelName: clamp(r.levelName, 16) as string,
    logger: clamp(r.logger, 128),
    message: clampMessage(r.message),
    traceId: clamp(r.traceId, 32),
    httpMethod: clamp(r.httpMethod, 10),
    route: clamp(r.route, 255),
    statusCode: inSmallInt(r.statusCode),
    durationMs: r.durationMs !== null && r.durationMs >= 0 && r.durationMs <= INT32_MAX ? r.durationMs : null,
    clientIp: clamp(r.clientIp, 45),
    userId: clamp(r.userId, 64),
    hostname: clamp(r.hostname, 128),
    attrs: r.attrs === null ? undefined : (r.attrs as object),
  };
}

/**
 * Rows and the offsets that account for them, in one transaction. That atomicity — not careful
 * ordering — is what gives no-loss-no-duplicate across a crash: the offset can never run ahead
 * of the data, so a restart re-reads exactly the bytes whose rows never landed.
 */
export async function persistBatch(db: PrismaService, records: LogRecord[], offsets: OffsetRow[]): Promise<void> {
  if (records.length === 0 && offsets.length === 0) return;

  await db.$transaction([
    db.logEntry.createMany({ data: records.map(toRow) }),
    ...offsets.map((o) =>
      db.ingestOffset.upsert({
        where: { filePath: o.filePath },
        create: o,
        update: { dev: o.dev, inode: o.inode, byteOffset: o.byteOffset },
      }),
    ),
  ]);
}

/**
 * The bounded queue between the tailer and the database.
 *
 * Queued as **chunks, never a flat record list**: an offset may only be committed alongside the
 * records it accounts for. A flat queue with a latest-offset map would commit an offset covering
 * rows still in memory — and a crash right there loses them, silently, which is the one failure
 * this whole module exists to rule out.
 */
export class Writer {
  private queue: Chunk[] = [];
  private queued = 0;

  /** Lines abandoned under backpressure. */
  dropped = 0;

  // Read by GET /api/collector/status. Held in memory on purpose: a status route that queries
  // MySQL goes silent exactly when MySQL is the problem — the one moment anybody looks at it.
  written = 0;
  lastWrittenAt: Date | null = null;

  constructor(
    private readonly db: { persist: (records: LogRecord[], offsets: OffsetRow[]) => Promise<void> },
    private readonly bus?: RecordSink,
  ) {}

  get queuedRecords(): number {
    return this.queued;
  }

  submit(chunk: Chunk): void {
    const room = MAX_QUEUED_RECORDS - this.queued;

    let records = chunk.records;
    if (records.length > room) {
      this.dropped += records.length - Math.max(room, 0);
      records = records.slice(0, Math.max(room, 0));
    }
    if (records.length === 0) return;

    // The offset still advances past dropped lines: the tailer's read head already has, so
    // holding the offset back would not save them — it would only re-ingest their neighbours
    // as duplicates after a restart. Dropped means dropped, and counted.
    this.queue.push({ records, offset: chunk.offset });
    this.queued += records.length;
  }

  /**
   * Drains whole chunks up to ~MAX_ROWS_PER_FLUSH records — always at least one, so a chunk
   * larger than the budget still moves. Driven on a 500 ms interval by the ingest service.
   */
  async flush(): Promise<void> {
    if (this.queue.length === 0) return;

    const batch: Chunk[] = [];
    let taken = 0;
    while (this.queue.length > 0 && (taken === 0 || taken + this.queue[0].records.length <= MAX_ROWS_PER_FLUSH)) {
      const chunk = this.queue.shift() as Chunk;
      batch.push(chunk);
      taken += chunk.records.length;
    }

    const records = batch.flatMap((c) => c.records);
    // Latest offset per file within the batch — later chunks supersede earlier ones.
    const byFile = new Map<string, OffsetRow>();
    for (const c of batch) byFile.set(c.offset.filePath, c.offset);

    try {
      await this.db.persist(records, [...byFile.values()]);
    } catch (err) {
      // Straight to stderr with the marker, never through the logger: this is the path that
      // would otherwise log its own failure, ingest that log and fail again. The chunks go back
      // to the front of the queue — persist only fails on connectivity now that rows are clamped
      // to their columns, so the retry on the next tick is the recovery, not a loop.
      this.queue.unshift(...batch);
      process.stderr.write(`${INGEST_SKIP_MARKER} failed to write batch: ${String(err)}\n`);
      return;
    }

    this.queued -= records.length;
    this.written += records.length;
    this.lastWrittenAt = new Date();

    // Publish only after the commit, so live tail never shows a rolled-back row.
    if (this.bus) for (const r of records) this.bus.emit(r);
  }
}
