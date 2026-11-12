import { PrismaService } from "@db/prisma.service";
import { Injectable } from "@nestjs/common";
import { assembleSpans, MAX_CONTENT_PER_TRACE, MAX_EVENTS_PER_TRACE, MAX_SPANS_PER_TRACE } from "./trace-rows";

import type { SpanRow } from "@contracts/traces";

/**
 * One trace's spans (IKN-87) — the run list moved to `runs/ai-runs.service.ts` (IKN-91). Bounded by
 * a `[from, to)` window on `ts`, for the reason every log route is: `span` is partitioned by day, and
 * the range is what lets MySQL skip whole partitions before it reads a row.
 */
@Injectable()
export class TracesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every span of one trace in the window, in start order, through the `(trace_id, span_id, ts)`
   * key — with its events, and its content while retained (IKN-87 v2). Three bounded reads by the
   * trace id each table's unique key starts with; content past its `expires_at` is not read even
   * when the hourly purge has not reached it yet, so "expired" means expired to the minute.
   */
  async spans(traceId: string, from: Date, to: Date): Promise<{ spans: SpanRow[]; truncated: boolean }> {
    const window = { gte: from, lt: to };
    const [rows, events, contents] = await Promise.all([
      this.prisma.span.findMany({
        where: { traceId, ts: window },
        orderBy: [{ startUs: "asc" }, { id: "asc" }],
        take: MAX_SPANS_PER_TRACE + 1,
      }),
      this.prisma.spanEvent.findMany({ where: { traceId, ts: window }, take: MAX_EVENTS_PER_TRACE }),
      this.prisma.spanContent.findMany({
        where: { traceId, spanTs: window, expiresAt: { gt: new Date() } },
        take: MAX_CONTENT_PER_TRACE,
      }),
    ]);

    const truncated = rows.length > MAX_SPANS_PER_TRACE;
    return { spans: assembleSpans({ spans: rows.slice(0, MAX_SPANS_PER_TRACE), events, contents }), truncated };
  }
}
