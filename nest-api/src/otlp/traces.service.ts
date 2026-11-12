import { PrismaService } from "@db/prisma.service";
import { Prisma } from "@generated/prisma/client";
import { Injectable } from "@nestjs/common";
import { CONCAT_SEPARATOR, MAX_SPANS_PER_TRACE, toSpanRow, toSummary } from "./trace-rows";

import type { SpanRow, TraceSummary } from "@contracts/traces";
import type { RawTraceRow, TraceListQuery } from "./interfaces/otlp-types";

/**
 * The Traces view's two reads (IKN-87). Both bounded by a `[from, to)` window on `ts`, for the
 * reason every log route is: `span` is partitioned by day, and the range is what lets MySQL skip
 * whole partitions before it reads a row.
 */
@Injectable()
export class TracesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One row per trace that has spans in the window, newest first — `limit + 1` asked for, so the
   * caller learns whether there were more without a second `COUNT`.
   *
   * The root's name is the first of the trace's span names ordered roots-first, then by start: a
   * trace whose root fell outside the window (or never arrived — the tab closed mid-run) still
   * gets the name of its earliest span instead of a blank. `GROUP_CONCAT` is cut at 1 024 bytes by
   * default, which always holds the first 255-character name whole.
   *
   * A trace straddling the window's edge is summarised from the spans inside it. That is the same
   * honest limit the log histogram has, and the detail read is given a wider window.
   */
  /**
   * MySQL's `SEPARATOR` takes a string literal, never a bound parameter: the constant is written
   * into the statement (it is ours and holds no quote), the values stay bound.
   */
  private static readonly SEPARATOR = Prisma.raw(`'${CONCAT_SEPARATOR}'`);

  async list(q: TraceListQuery): Promise<{ traces: TraceSummary[]; truncated: boolean }> {
    const raw = await this.prisma.$queryRaw<RawTraceRow[]>`
      SELECT trace_id AS traceId,
             MIN(service) AS service,
             GROUP_CONCAT(name ORDER BY parent_span_id IS NOT NULL, start_us SEPARATOR ${TracesService.SEPARATOR}) AS rootName,
             CAST(MIN(start_us) AS SIGNED) AS startUs,
             CAST(MAX(start_us + duration_us) AS SIGNED) AS endUs,
             COUNT(*) AS spanCount,
             MAX(status_code = 2) AS anyError,
             MAX(status_code = 1) AS anyOk,
             CAST(SUM(input_tokens) AS SIGNED) AS inputTokens,
             CAST(SUM(output_tokens) AS SIGNED) AS outputTokens,
             GROUP_CONCAT(DISTINCT gen_ai_model ORDER BY gen_ai_model SEPARATOR ${TracesService.SEPARATOR}) AS models
        FROM span
       WHERE service = ${q.service} AND ts >= ${q.from} AND ts < ${q.to}
       GROUP BY trace_id
       ORDER BY startUs DESC
       LIMIT ${q.limit + 1}`;

    const truncated = raw.length > q.limit;
    return { traces: raw.slice(0, q.limit).map(toSummary), truncated };
  }

  /** Every span of one trace in the window, in start order, through the `(trace_id, span_id, ts)` key. */
  async spans(traceId: string, from: Date, to: Date): Promise<{ spans: SpanRow[]; truncated: boolean }> {
    const rows = await this.prisma.span.findMany({
      where: { traceId, ts: { gte: from, lt: to } },
      orderBy: [{ startUs: "asc" }, { id: "asc" }],
      take: MAX_SPANS_PER_TRACE + 1,
    });

    const truncated = rows.length > MAX_SPANS_PER_TRACE;
    return { spans: rows.slice(0, MAX_SPANS_PER_TRACE).map(toSpanRow), truncated };
  }
}
