import { describe, expect, it, vi } from "vitest";
import { MAX_QUEUED_RECORDS, Writer } from "./writer";

import type { LogRecord } from "./log-record";

const record = (message: string): LogRecord => ({
  ts: new Date(),
  service: "t",
  level: 30,
  levelName: "info",
  logger: null,
  message,
  traceId: null,
  httpMethod: null,
  route: null,
  statusCode: null,
  durationMs: null,
  clientIp: null,
  userId: null,
  hostname: null,
  attrs: null,
});

const chunk = (n: number) => ({
  records: Array.from({ length: n }, (_, i) => record(`line ${i}`)),
  offset: { filePath: "/tmp/a.log", dev: 1n, inode: 2n, byteOffset: 10n },
});

describe("Writer backpressure", () => {
  it("drops and counts rather than growing without bound", () => {
    const w = new Writer({ persist: vi.fn() }, { emit: vi.fn() });

    for (let i = 0; i < 50; i++) w.submit(chunk(MAX_QUEUED_RECORDS / 10));

    expect(w.queuedRecords).toBeLessThanOrEqual(MAX_QUEUED_RECORDS);
    expect(w.dropped).toBeGreaterThan(0);
  });

  it("does not drop under normal load", () => {
    const w = new Writer({ persist: vi.fn() }, { emit: vi.fn() });
    w.submit(chunk(10));
    expect(w.dropped).toBe(0);
  });

  it("publishes to the bus only after a successful persist", async () => {
    const emit = vi.fn();
    const persist = vi.fn().mockRejectedValueOnce(new Error("db down")).mockResolvedValue(undefined);
    const w = new Writer({ persist }, { emit });

    w.submit(chunk(5));
    await w.flush();
    // The batch failed: nothing may reach the live tail, and nothing is lost either.
    expect(emit).not.toHaveBeenCalled();
    expect(w.queuedRecords).toBe(5);

    await w.flush();
    expect(emit).toHaveBeenCalledTimes(5);
    expect(w.queuedRecords).toBe(0);
    expect(w.written).toBe(5);
  });

  it("never commits an offset ahead of its records", async () => {
    // Two chunks from the same file. A flush that drains only the first must carry the FIRST
    // chunk's offset — committing the second's would skip its still-queued records on a crash.
    const persisted: Array<{ records: number; byteOffset: bigint }> = [];
    const persist = vi.fn().mockImplementation(async (records: unknown[], offsets: { byteOffset: bigint }[]) => {
      persisted.push({ records: records.length, byteOffset: offsets[0]?.byteOffset ?? -1n });
    });
    const w = new Writer({ persist }, { emit: vi.fn() });

    w.submit({
      records: Array.from({ length: 150 }, (_, i) => record(`a${i}`)),
      offset: { filePath: "/tmp/a.log", dev: 1n, inode: 2n, byteOffset: 1000n },
    });
    w.submit({
      records: Array.from({ length: 150 }, (_, i) => record(`b${i}`)),
      offset: { filePath: "/tmp/a.log", dev: 1n, inode: 2n, byteOffset: 2000n },
    });

    await w.flush();
    expect(persisted[0]).toEqual({ records: 150, byteOffset: 1000n });

    await w.flush();
    expect(persisted[1]).toEqual({ records: 150, byteOffset: 2000n });
  });
});
