import { open, stat } from "node:fs/promises";
import { logger } from "@common/logger";
import { LineBuffer } from "./line-buffer";
import { decide } from "./rotation";

import type { LogRecord } from "./log-record";
import type { StoredOffset } from "./rotation";
import type { Source, SourceFile } from "./source";
import type { Chunk } from "./writer";

/**
 * Follows every file its sources list, and turns growth into parsed records.
 *
 * It knows nothing about log formats or filenames any more: a `Source` says which files to sweep
 * and how to read a line, and everything here is the I/O and the bookkeeping around that.
 *
 * Polling by `stat` on an interval, **not `fs.watch`** — watch is unreliable across filesystems
 * and editors, and at a one-second cadence polling seventeen files costs nothing measurable.
 * The rotation decision itself lives in `rotation.ts`, pure and tested; this class is the thin
 * I/O around it.
 */

const READ_CHUNK = 256 * 1024;

export class Tailer {
  /** `committed` is the last position handed downstream, which is how a chunk's byte span is measured. */
  private readonly state = new Map<string, { offset: StoredOffset; buffer: LineBuffer; committed: bigint }>();

  /** Bytes lifted off disk since this process started. Served by `/api/collector/status`. */
  bytesRead = 0;

  /**
   * When the last full pass finished — the collector's heartbeat (IKN-24).
   *
   * **This, and not "when a line last arrived", is what tells the pastille the collector is
   * alive.** ks-b is one person's server: it goes genuinely quiet for hours, and a liveness check
   * keyed on lines arriving would call that an outage every night. A pass sets this whether it
   * found bytes or not, so it goes stale only when the loop itself has stopped — which is exactly
   * the failure worth a red dot, and it shows within seconds rather than within a retention
   * window.
   */
  lastPollAt: Date | null = null;

  constructor(
    private readonly sources: Source[],
    private readonly submit: (chunk: Chunk) => void,
  ) {}

  /**
   * Seeds the in-memory positions from `IngestOffset` at startup — the other half of the
   * no-loss-no-duplicate guarantee. The buffers start empty: a partial line carried across a
   * restart was never written anywhere, and its bytes are still on disk after the stored offset.
   */
  hydrate(offsets: Array<StoredOffset & { filePath: string }>): void {
    for (const o of offsets) {
      this.state.set(o.filePath, {
        offset: { dev: o.dev, inode: o.inode, byteOffset: o.byteOffset },
        buffer: new LineBuffer(),
        committed: o.byteOffset,
      });
    }
  }

  /**
   * One pass over every file of every source. Driven on a one-second interval by the ingest
   * service.
   *
   * Sources are asked for their files each tick rather than at boot, which is how a newly
   * deployed PM2 app — and now a newly registered site — is picked up without restarting Iknos.
   */
  async poll(): Promise<void> {
    for (const source of this.sources) {
      let files: SourceFile[];
      try {
        files = await source.files();
      } catch (err) {
        // A source that cannot even list its files must not stop the others. The nginx source
        // reads MySQL to find them, so this is the database-down case — and the PM2 logs are
        // exactly what someone debugging a database outage is reading.
        logger.error({ err, source: source.name }, "source file listing failed");
        continue;
      }

      for (const sf of files) {
        try {
          await this.pollOne(sf, source);
        } catch {
          // A file that vanished mid-poll is normal during rotation. Never let one bad file stop
          // the others.
        }
      }
    }
    // Stamped after the whole sweep, and only on the way out. A pass that threw before reaching
    // here — the glob itself failing, the pattern pointing at a directory that has gone — leaves
    // the previous stamp standing and lets it go stale, which is the honest reading: the loop is
    // running but it is not working.
    this.lastPollAt = new Date();
  }

  /** How many files are being followed, for the status route. */
  get trackedFiles(): number {
    return this.state.size;
  }

  private async pollOne(sf: SourceFile, source: Source): Promise<void> {
    const { file, service, stream } = sf;
    const st = await stat(file, { bigint: true });
    const now = { dev: st.dev, inode: st.ino, len: st.size };

    let entry = this.state.get(file);
    const action = decide(entry?.offset ?? null, now);
    if (action.kind === "idle") return;

    if (!entry || action.kind === "restart") {
      // A replaced file means any carried partial line belongs to a file that no longer exists.
      // Discarding it is correct.
      entry = {
        offset: { dev: now.dev, inode: now.inode, byteOffset: 0n },
        buffer: new LineBuffer(),
        committed: action.from,
      };
      this.state.set(file, entry);
    }

    const fh = await open(file, "r");
    try {
      let pos = action.from;
      const buf = Buffer.alloc(READ_CHUNK);

      for (;;) {
        const { bytesRead } = await fh.read(buf, 0, READ_CHUNK, Number(pos));
        if (bytesRead === 0) break;

        pos += BigInt(bytesRead);
        this.bytesRead += bytesRead;
        entry.buffer.push(buf.subarray(0, bytesRead));

        // The in-memory offset moves with the buffer, in the same breath, and never later.
        //
        // It used to be assigned once after the loop. Anything thrown in between — a read on a
        // file being rotated away, an OOM — unwinds to the deliberately empty `catch` in
        // `poll()`, leaving the buffer holding bytes that the offset did not know about. The next
        // tick then re-read those same bytes and appended them to the stale fragment: duplicated
        // rows, plus one corrupted line where the two halves met. Duplication is the one thing
        // this module exists to prevent, so the two facts move together or not at all.
        entry.offset = { dev: now.dev, inode: now.inode, byteOffset: pos };

        const records: LogRecord[] = [];
        for (let line = entry.buffer.nextLine(); line !== null; line = entry.buffer.nextLine()) {
          const record = source.parse(line, service, stream);
          if (record) records.push(record);
        }
        if (records.length === 0) continue;

        // The offset reported downstream is the position of the last complete line, not the read
        // head: bytes still in the buffer have not been stored anywhere, and an offset that
        // includes them would skip them forever after a restart.
        const committed = pos - BigInt(entry.buffer.pendingBytes);
        // The chunk's own byte span: how far the committed position moved. Measured here rather
        // than added up from the records because the parser drops blank lines and health-probe
        // noise and clamps long messages — summing what was stored would report a fraction of
        // what the disk actually served, on the one card whose job is to say how much that was.
        const bytes = Number(committed - entry.committed);
        entry.committed = committed;

        this.submit({
          records,
          offset: { filePath: file, dev: now.dev, inode: now.inode, byteOffset: committed },
          bytes,
        });
      }
    } finally {
      await fh.close();
    }
  }
}
