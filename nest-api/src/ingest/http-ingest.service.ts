import { PrismaService } from "@db/prisma.service";
import { Injectable } from "@nestjs/common";
import { LogBus } from "@stream/log-bus";
import { parse } from "./parser";
import { persistBatch } from "./writer";

import type { LogRecord } from "./log-record";

/**
 * The second way a log line gets in: posted, rather than read off a file.
 *
 * It exists for the one thing tailing cannot do — a browser has no stdout, so a JavaScript error
 * on a page never reaches ks-b's disk. Every other source stays on the collector, and that is not
 * purism: a process that crashes does not POST its own stack trace, and the tailer catches the
 * crash, the OOM kill and the logs of libraries nobody controls.
 *
 * Posted events go through **the same parser** as tailed lines. The round trip through
 * `JSON.stringify` is deliberate waste: it costs microseconds on a handful of events and it
 * guarantees the two paths can never drift on what ECS means, which field is promoted to which
 * column, or how a malformed event degrades.
 */

/** Enough for a page's worth of errors in one flush, small enough that a batch stays a batch. */
export const MAX_EVENTS_PER_REQUEST = 100;

export type IngestResult = { accepted: number; rejected: number };

/**
 * A single event, converted or discarded. Never throws: one malformed entry in a batch must not
 * cost the caller the rest of it, which is the same rule the collector applies to a bad line.
 */
function toRecord(event: unknown, service: string): LogRecord | null {
  if (typeof event !== "object" || event === null || Array.isArray(event)) return null;

  try {
    // `"out"`, always. The stream only decides the fallback level for lines that carry none, and
    // a posted event that omits `log.level` is a note, not a crash — `err` would silently mark
    // every unlabelled browser event as an error.
    return parse(JSON.stringify(event), service, "out");
  } catch {
    return null;
  }
}

@Injectable()
export class HttpIngestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: LogBus,
  ) {}

  /**
   * Written straight through rather than queued on the `Writer`, and the difference is a
   * requirement rather than a shortcut.
   *
   * The collector may never lose a line, so it queues, retries and drops only under memory
   * pressure. A POST is the opposite: the caller is still on the phone, so a database failure
   * should reach it as an error it can retry — and a browser dropping one error report is a far
   * smaller loss than the API pretending it stored something it did not.
   */
  async ingest(service: string, events: unknown[]): Promise<IngestResult> {
    const records = events.map((event) => toRecord(event, service)).filter((r): r is LogRecord => r !== null);

    if (records.length > 0) {
      await persistBatch(this.prisma, records, []);
      // After the commit, never before — the live tail must not show a line a rollback then
      // un-writes. Same ordering the writer keeps.
      for (const record of records) this.bus.emit(record);
    }

    return { accepted: records.length, rejected: events.length - records.length };
  }

  /**
   * A sender may only write under a name the registry already knows, and only while it is
   * enabled.
   *
   * Without this the token alone would let anyone file lines as `iknos-api` — and lines that
   * claim to come from the monitoring itself are the ones an operator trusts most.
   */
  async isKnownService(name: string): Promise<boolean> {
    const service = await this.prisma.service.findUnique({ where: { name }, select: { enabled: true } });
    return service?.enabled === true;
  }
}
