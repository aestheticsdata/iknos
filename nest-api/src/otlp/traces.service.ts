import { PrismaService } from "@db/prisma.service";
import { Prisma } from "@generated/prisma/client";
import { Injectable } from "@nestjs/common";
import { EVALUATION_ATTR, EVALUATION_LABEL, EVENT_NAME } from "./otlp-limits";
import {
  assembleSpans,
  CONCAT_SEPARATOR,
  MAX_CONTENT_PER_TRACE,
  MAX_EVENTS_PER_TRACE,
  MAX_SPANS_PER_TRACE,
  toSummary,
} from "./trace-rows";

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
   *
   * The failed-evaluation and human-feedback counts (IKN-87 v2) come from `span_event` over the
   * same service and window — its `ts` is its span's, so the two windows select the same spans —
   * grouped by trace before the join, so a span's row is never repeated once per event.
   */
  /**
   * MySQL's `SEPARATOR` takes a string literal, never a bound parameter: the constant is written
   * into the statement (it is ours and holds no quote), the values stay bound.
   */
  private static readonly SEPARATOR = Prisma.raw(`'${CONCAT_SEPARATOR}'`);

  /** The JSON path of an evaluation's label: the key has dots, so it is quoted inside the path. */
  private static readonly LABEL_PATH = `$."${EVALUATION_ATTR.label}"`;

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
             GROUP_CONCAT(DISTINCT gen_ai_model ORDER BY gen_ai_model SEPARATOR ${TracesService.SEPARATOR}) AS models,
             MAX(ev.failedEvaluations) AS failedEvaluations,
             MAX(ev.humanFeedback) AS humanFeedback
        FROM span
        LEFT JOIN (
              SELECT trace_id AS evTraceId,
                     SUM(name = ${EVENT_NAME.evaluation}
                         AND JSON_UNQUOTE(JSON_EXTRACT(attrs, ${TracesService.LABEL_PATH})) = ${EVALUATION_LABEL.fail}) AS failedEvaluations,
                     SUM(name = ${EVENT_NAME.humanFeedback}) AS humanFeedback
                FROM span_event
               WHERE service = ${q.service} AND ts >= ${q.from} AND ts < ${q.to}
               GROUP BY trace_id
             ) ev ON ev.evTraceId = span.trace_id
       WHERE service = ${q.service} AND ts >= ${q.from} AND ts < ${q.to}
       GROUP BY trace_id
       ORDER BY startUs DESC
       LIMIT ${q.limit + 1}`;

    const truncated = raw.length > q.limit;
    return { traces: raw.slice(0, q.limit).map(toSummary), truncated };
  }

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
