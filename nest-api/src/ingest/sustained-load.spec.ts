import { describe, expect, it } from "vitest";
import { LineBuffer } from "./line-buffer";
import { parse } from "./parser";
import { MAX_QUEUED_RECORDS, Writer } from "./writer";

import type { LogRecord } from "./log-record";
import type { OffsetRow } from "./writer";

/**
 * The volume the ticket names. Large enough that anything retained per line shows up as tens of
 * megabytes, small enough to stay a unit test.
 */
const LINES = 100_000;

/** Kernel reads do not respect line boundaries, so neither does this. */
const READ_BYTES = 64 * 1024;

/**
 * What retaining every record would cost, conservatively: a LogRecord is a Date plus sixteen
 * fields, several of them strings, so well over 500 bytes once V8 is done with it. The ceiling
 * sits far below that and far above ordinary allocator noise — the gap is the point, because a
 * tight bound here would fail on GC timing rather than on a leak.
 */
const MAX_GROWTH_BYTES = 32 * 1024 * 1024;

/** One file, one offset row: the tailer always submits records with the offset accounting for them. */
const OFFSET: OffsetRow = { filePath: "/tmp/sustained-out.log", dev: 1n, inode: 2n, byteOffset: 0n };

const ecsLine = (i: number) =>
  `${JSON.stringify({
    "@timestamp": new Date(Date.UTC(2026, 7, 18, 12, 0, 0, i % 1000)).toISOString(),
    "log.level": i % 100 === 0 ? "error" : "info",
    message: `request completed ${i} — accentué, to keep the decoder honest`,
    "trace.id": (i % 997).toString(16).padStart(12, "0"),
    "http.request.method": "GET",
    "url.path": `/api/users/${i}`,
    "http.response.status_code": 200,
    "event.duration": 2_000_000,
  })}\n`;

describe("sustained ingestion", () => {
  it(`carries ${LINES.toLocaleString("en-US")} lines without retaining them`, async () => {
    // Plain stubs, deliberately not `vi.fn()`: a spy retains every call's arguments, so at this
    // volume the *instrument* holds 100 000 records and reports itself as a leak in the collector.
    let persistCalls = 0;
    const w = new Writer(
      {
        persist: async (_records: LogRecord[]) => {
          persistCalls++;
        },
      },
      { emit: () => {} },
    );
    const buffer = new LineBuffer();

    const drain = async () => {
      while (w.queuedRecords > 0) await w.flush();
    };

    // Warm every code path once, so the baseline holds the lazily-built things — regex caches,
    // hidden classes, the flush closure — instead of charging them to the measurement.
    buffer.push(Buffer.from(ecsLine(0)));
    const warmLine = buffer.nextLine();
    const warmRecord = warmLine === null ? null : parse(warmLine, "t", "out");
    if (warmRecord !== null) w.submit({ records: [warmRecord], offset: OFFSET });
    await drain();

    // The warm-up line is real ingestion and counts toward the writer's totals; measure the run
    // against where it left off rather than against zero.
    const writtenBefore = w.written;

    // Fail loudly rather than measure nothing: without `--expose-gc` (supplied by the `test`
    // script) the heap figure below is dominated by uncollected garbage and the assertion stops
    // meaning anything. Narrowed rather than `?.`-ed, because a skipped collection is precisely
    // the silent no-op this guard exists to prevent.
    const gc = global.gc;
    if (typeof gc !== "function") throw new Error("run with --expose-gc; see the test script in package.json");

    gc();
    const baseline = process.memoryUsage().heapUsed;

    let peakPending = 0;
    let peakQueued = 0;
    let submitted = 0;
    let pending = Buffer.alloc(0);

    for (let i = 1; i <= LINES; i++) {
      pending = Buffer.concat([pending, Buffer.from(ecsLine(i))]);

      // Hand the buffer whole reads, cut wherever they land — mid-line, mid-codepoint.
      while (pending.length >= READ_BYTES) {
        buffer.push(pending.subarray(0, READ_BYTES));
        pending = pending.subarray(READ_BYTES);

        const records: LogRecord[] = [];
        for (let line = buffer.nextLine(); line !== null; line = buffer.nextLine()) {
          const record = parse(line, "t", "out");
          if (record !== null) records.push(record);
        }

        if (records.length > 0) {
          submitted += records.length;
          w.submit({ records, offset: OFFSET });
          peakQueued = Math.max(peakQueued, w.queuedRecords);
        }
        peakPending = Math.max(peakPending, buffer.pendingBytes);

        // Drain the way the real writer does, on its interval, rather than letting the queue
        // fill and drop — dropping is the backpressure test, this one is about drift.
        await drain();
      }
    }

    buffer.push(pending);
    const tail: LogRecord[] = [];
    for (let line = buffer.nextLine(); line !== null; line = buffer.nextLine()) {
      const record = parse(line, "t", "out");
      if (record !== null) tail.push(record);
    }
    if (tail.length > 0) {
      submitted += tail.length;
      w.submit({ records: tail, offset: OFFSET });
    }
    await drain();

    gc();
    const growth = process.memoryUsage().heapUsed - baseline;

    // Everything arrived, and nothing was dropped: a run that quietly shed 90% of its lines
    // would use very little memory and prove nothing.
    expect(submitted).toBe(LINES);
    expect(w.written - writtenBefore).toBe(LINES);
    expect(w.dropped).toBe(0);
    expect(persistCalls).toBeGreaterThan(0);

    // The two structural bounds, held the whole way rather than only at the end.
    expect(peakQueued).toBeLessThanOrEqual(MAX_QUEUED_RECORDS);
    expect(peakPending).toBeLessThan(READ_BYTES + 4096);

    expect(growth).toBeLessThan(MAX_GROWTH_BYTES);
  }, 120_000);
});
