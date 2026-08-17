import { glob, open, stat } from "node:fs/promises";
import path from "node:path";
import { LineBuffer } from "./line-buffer";
import { parse } from "./parser";
import { decide } from "./rotation";

import type { LogRecord } from "./log-record";
import type { StoredOffset } from "./rotation";
import type { Chunk } from "./writer";

/**
 * Follows every file matching the PM2 log glob and turns growth into parsed records.
 *
 * Polling by `stat` on an interval, **not `fs.watch`** — watch is unreliable across filesystems
 * and editors, and at a one-second cadence polling seventeen files costs nothing measurable.
 * The rotation decision itself lives in `rotation.ts`, pure and tested; this class is the thin
 * I/O around it.
 */

const READ_CHUNK = 256 * 1024;

/** PM2 names its files `<app>-out.log` and `<app>-error.log`. */
function serviceAndStream(file: string): { service: string; stream: "out" | "err" } {
  const stem = path.basename(file, path.extname(file));
  if (stem.endsWith("-error")) return { service: stem.slice(0, -"-error".length), stream: "err" };
  if (stem.endsWith("-out")) return { service: stem.slice(0, -"-out".length), stream: "out" };
  return { service: stem, stream: "out" };
}

export class Tailer {
  private readonly state = new Map<string, { offset: StoredOffset; buffer: LineBuffer }>();

  constructor(
    private readonly pattern: string,
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
      });
    }
  }

  /**
   * One pass over every matching file. Driven on a one-second interval by the ingest service.
   *
   * Re-globbing each tick is how a newly deployed PM2 app is picked up without restarting Iknos —
   * `fs.promises.glob` is native since Node 22, so this costs no dependency.
   */
  async poll(): Promise<void> {
    for await (const file of glob(this.pattern)) {
      try {
        await this.pollOne(file);
      } catch {
        // A file that vanished mid-poll is normal during rotation. Never let one bad file stop
        // the others.
      }
    }
  }

  private async pollOne(file: string): Promise<void> {
    const st = await stat(file, { bigint: true });
    const now = { dev: st.dev, inode: st.ino, len: st.size };

    let entry = this.state.get(file);
    const action = decide(entry?.offset ?? null, now);
    if (action.kind === "idle") return;

    if (!entry || action.kind === "restart") {
      // A replaced file means any carried partial line belongs to a file that no longer exists.
      // Discarding it is correct.
      entry = { offset: { dev: now.dev, inode: now.inode, byteOffset: 0n }, buffer: new LineBuffer() };
      this.state.set(file, entry);
    }

    const { service, stream } = serviceAndStream(file);
    const fh = await open(file, "r");
    try {
      let pos = action.from;
      const buf = Buffer.alloc(READ_CHUNK);

      for (;;) {
        const { bytesRead } = await fh.read(buf, 0, READ_CHUNK, Number(pos));
        if (bytesRead === 0) break;

        pos += BigInt(bytesRead);
        entry.buffer.push(buf.subarray(0, bytesRead));

        const records: LogRecord[] = [];
        for (let line = entry.buffer.nextLine(); line !== null; line = entry.buffer.nextLine()) {
          const record = parse(line, service, stream);
          if (record) records.push(record);
        }
        if (records.length === 0) continue;

        // The offset reported downstream is the position of the last complete line, not the read
        // head: bytes still in the buffer have not been stored anywhere, and an offset that
        // includes them would skip them forever after a restart.
        const committed = pos - BigInt(entry.buffer.pendingBytes);
        this.submit({
          records,
          offset: { filePath: file, dev: now.dev, inode: now.inode, byteOffset: committed },
        });
      }

      // The in-memory position does include the partial line — the bytes were read and are held
      // in the buffer, so re-reading them next tick would emit the line twice.
      entry.offset = { dev: now.dev, inode: now.inode, byteOffset: pos };
    } finally {
      await fh.close();
    }
  }
}
