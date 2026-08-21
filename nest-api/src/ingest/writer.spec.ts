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
  bytes: n * 10,
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
      bytes: 1000,
    });
    w.submit({
      records: Array.from({ length: 150 }, (_, i) => record(`b${i}`)),
      offset: { filePath: "/tmp/a.log", dev: 1n, inode: 2n, byteOffset: 2000n },
      bytes: 1000,
    });

    await w.flush();
    expect(persisted[0]).toEqual({ records: 150, byteOffset: 1000n });

    await w.flush();
    expect(persisted[1]).toEqual({ records: 150, byteOffset: 2000n });
  });
});

/**
 * The numbers `GET /api/collector/status` serves (IKN-24).
 *
 * All of them are read off this class rather than out of MySQL, which is the whole point: the
 * status route has to keep answering on the day the database is the thing that broke.
 */
describe("Writer instrumentation", () => {
  const at = (iso: string): LogRecord => ({ ...record("x"), ts: new Date(iso) });

  it("knows nothing before the first flush, and says null rather than zero", () => {
    const w = new Writer({ persist: vi.fn() }, { emit: vi.fn() });
    expect(w.lagMs).toBeNull();
    expect(w.lastWrittenAt).toBeNull();
    expect(w.rate.snapshot(Date.now())).toBeNull();
  });

  it("measures lag from the newest line in the batch, not from the last one in the array", async () => {
    const w = new Writer({ persist: vi.fn() }, { emit: vi.fn() });
    const now = Date.parse("2026-08-21T12:00:10Z");
    vi.setSystemTime(now);

    // Out of order on purpose: two files are tailed independently, so a batch routinely carries
    // an older line after a newer one.
    w.submit({
      records: [at("2026-08-21T12:00:08Z"), at("2026-08-21T12:00:04Z")],
      offset: { filePath: "/tmp/a.log", dev: 1n, inode: 2n, byteOffset: 10n },
      bytes: 200,
    });
    await w.flush();

    expect(w.lagMs).toBe(2000);
    vi.useRealTimers();
  });

  it("clamps a line stamped in the future to zero rather than reporting negative lag", async () => {
    const w = new Writer({ persist: vi.fn() }, { emit: vi.fn() });
    vi.setSystemTime(Date.parse("2026-08-21T12:00:00Z"));

    w.submit({
      records: [at("2026-08-21T12:05:00Z")],
      offset: { filePath: "/tmp/a.log", dev: 1n, inode: 2n, byteOffset: 10n },
      bytes: 100,
    });
    await w.flush();

    expect(w.lagMs).toBe(0);
    vi.useRealTimers();
  });

  it("feeds the sparkline with what it wrote, and the bytes with it", async () => {
    const w = new Writer({ persist: vi.fn() }, { emit: vi.fn() });
    w.submit(chunk(4));
    await w.flush();

    const snapshot = w.rate.snapshot(Date.now());
    expect(snapshot?.total).toBe(4);
    expect(snapshot?.bytes).toBe(40);
  });

  it("counts nothing into the window when the batch failed to persist", async () => {
    const w = new Writer({ persist: vi.fn().mockRejectedValue(new Error("db down")) }, { emit: vi.fn() });
    w.submit(chunk(4));
    await w.flush();

    // The lines are still queued for the retry, so counting them now would double-count them
    // later — and, worse, would draw an ingest line that is climbing while nothing lands.
    expect(w.rate.snapshot(Date.now())).toBeNull();
    expect(w.lagMs).toBeNull();
  });

  it("counts lines that had to be stored degraded", async () => {
    const w = new Writer({ persist: vi.fn() }, { emit: vi.fn() });
    w.submit({
      records: [record("clean"), { ...record("{not json"), degraded: true }],
      offset: { filePath: "/tmp/a.log", dev: 1n, inode: 2n, byteOffset: 10n },
      bytes: 200,
    });
    await w.flush();

    expect(w.written).toBe(2);
    expect(w.degraded).toBe(1);
  });

  it("attributes only the kept share of a truncated chunk's bytes", () => {
    const w = new Writer({ persist: vi.fn() }, { emit: vi.fn() });
    // Fill the queue to within ten of the ceiling, then offer twenty.
    w.submit(chunk(MAX_QUEUED_RECORDS - 10));
    w.submit(chunk(20));

    expect(w.dropped).toBe(10);
    expect(w.queuedRecords).toBe(MAX_QUEUED_RECORDS);
  });
});
