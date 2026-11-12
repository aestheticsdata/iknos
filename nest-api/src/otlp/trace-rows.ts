import { readJsonColumn } from "@common/json-column";
import { CONTENT_STATE, TRACE_STATUS } from "@contracts/traces";
import { BadRequestException } from "@nestjs/common";
import { SPAN_LEVEL_INDEX, STATUS_MESSAGE_CONTENT_KEY } from "./otlp-limits";

import type { ContentState, SpanEventRow, SpanRow, TraceStatus, TraceSummary } from "@contracts/traces";
import type { Span, SpanContent, SpanEvent } from "@generated/prisma/client";
import type { RawTraceRow, TraceRows } from "./interfaces/otlp-types";

/**
 * Turning `span` rows into the Traces view's contracts (IKN-87). Pure, so the arithmetic and the
 * edge cases are tested without a database.
 */

/** The separator `GROUP_CONCAT` joins names and models with — a control character no name contains. */
export const CONCAT_SEPARATOR = "\u001f";

export const DEFAULT_TRACE_LIMIT = 100;
export const MAX_TRACE_LIMIT = 500;

/** A trace with more spans than this is a loop, not a run anyone reads span by span. */
export const MAX_SPANS_PER_TRACE = 2000;

/** Events and content rows read for one trace — far above any real run, a bound on a broken one. */
export const MAX_EVENTS_PER_TRACE = 20_000;
export const MAX_CONTENT_PER_TRACE = 20_000;

/** OTLP/W3C trace ids: 32 lower-case hex. A shape check before the index walk, not a security one. */
export const TRACE_ID_SHAPE = /^[0-9a-f]{32}$/;

/** `bigint`, `Decimal`, string or number, as the driver chose — or `null` for SQL NULL. */
function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** The trace's verdict: any failure wins, then any explicit success. */
function statusOf(raw: RawTraceRow): TraceStatus {
  if ((num(raw.anyError) ?? 0) > 0) return TRACE_STATUS.error;
  if ((num(raw.anyOk) ?? 0) > 0) return TRACE_STATUS.ok;
  return TRACE_STATUS.unset;
}

export function toSummary(raw: RawTraceRow): TraceSummary {
  const startUs = num(raw.startUs) ?? 0;
  const endUs = num(raw.endUs) ?? startUs;

  return {
    traceId: raw.traceId,
    service: raw.service,
    rootName: raw.rootName?.split(CONCAT_SEPARATOR)[0] ?? "",
    startUs,
    durationUs: Math.max(0, endUs - startUs),
    spanCount: num(raw.spanCount) ?? 0,
    status: statusOf(raw),
    inputTokens: num(raw.inputTokens),
    outputTokens: num(raw.outputTokens),
    models: raw.models ? raw.models.split(CONCAT_SEPARATOR).filter((m) => m !== "") : [],
    failedEvaluations: num(raw.failedEvaluations) ?? 0,
    humanFeedback: num(raw.humanFeedback) ?? 0,
  };
}

/** The key one span's rows are grouped under: its id, and its `ts`, as the unique keys have it. */
const ownerKey = (spanId: string, ts: Date): string => `${spanId}@${ts.getTime()}`;

/** A JSON-encoded content value back to what was sent; text that will not parse is kept as text. */
function contentValue(row: SpanContent): unknown {
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

/** Content rows by owner and event index (`SPAN_LEVEL_INDEX` for the span's own). */
function groupContent(contents: SpanContent[]): Map<string, Map<number, Record<string, unknown>>> {
  const byOwner = new Map<string, Map<number, Record<string, unknown>>>();
  for (const row of contents) {
    const owner = ownerKey(row.spanId, row.spanTs);
    const byIndex = byOwner.get(owner) ?? new Map<number, Record<string, unknown>>();
    byOwner.set(owner, byIndex);
    const values = byIndex.get(row.eventIndex) ?? {};
    byIndex.set(row.eventIndex, values);
    values[row.contentKey] = contentValue(row);
  }
  return byOwner;
}

function toEventRow(event: SpanEvent, content: Record<string, unknown> | null): SpanEventRow {
  return {
    timeUs: Number(event.timeUs),
    name: event.name,
    attrs: readJsonColumn(event.attrs),
    content,
  };
}

/**
 * Retained when any of its content is still here; expired when some was kept and none is left;
 * none when nothing was ever kept. A span written before IKN-87 v2 has no mark and reads as none —
 * except that its `status_message` column still holds the message, which `toSpanRow` keeps.
 */
function contentStateOf(span: Span, retained: boolean): ContentState {
  if (retained) return CONTENT_STATE.retained;
  return span.contentUntil === null ? CONTENT_STATE.none : CONTENT_STATE.expired;
}

/** One span, its events and its retained content, merged back under the keys they were sent with. */
export function toSpanRow(span: Span, events: SpanEvent[], content: Map<number, Record<string, unknown>> | undefined) {
  const own = content?.get(SPAN_LEVEL_INDEX) ?? null;
  const { [STATUS_MESSAGE_CONTENT_KEY]: statusMessage, ...spanContent } = own ?? {};

  const row: SpanRow = {
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    service: span.service,
    name: span.name,
    kind: span.kind,
    startUs: Number(span.startUs),
    durationUs: Number(span.durationUs),
    statusCode: span.statusCode,
    statusMessage: typeof statusMessage === "string" ? statusMessage : span.statusMessage,
    genAiOperation: span.genAiOperation,
    genAiModel: span.genAiModel,
    inputTokens: span.inputTokens,
    outputTokens: span.outputTokens,
    attrs: readJsonColumn(span.attrs),
    events: events.map((event) => toEventRow(event, content?.get(event.eventIndex) ?? null)),
    content: Object.keys(spanContent).length > 0 ? spanContent : null,
    contentState: contentStateOf(span, content !== undefined && content.size > 0),
    contentDays: span.contentDays,
  };
  return row;
}

/**
 * The three tables' rows for one trace → the detail's spans. Pure: the joining is done here, by
 * the `(span_id, ts)` each row carries, rather than in SQL, because the three reads are already
 * bounded and a JOIN would repeat every span once per event.
 */
export function assembleSpans(rows: TraceRows): SpanRow[] {
  const eventsByOwner = new Map<string, SpanEvent[]>();
  for (const event of [...rows.events].sort((a, b) => Number(a.timeUs - b.timeUs) || a.eventIndex - b.eventIndex)) {
    const owner = ownerKey(event.spanId, event.ts);
    const list = eventsByOwner.get(owner) ?? [];
    eventsByOwner.set(owner, list);
    list.push(event);
  }
  const contentByOwner = groupContent(rows.contents);

  return rows.spans.map((span) => {
    const owner = ownerKey(span.spanId, span.ts);
    return toSpanRow(span, eventsByOwner.get(owner) ?? [], contentByOwner.get(owner));
  });
}

/** `?limit=`: absent is the default, anything else must be a whole number within the ceiling. */
export function parseTraceLimit(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_TRACE_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_TRACE_LIMIT) {
    throw new BadRequestException(`'limit' must be a whole number between 1 and ${MAX_TRACE_LIMIT}`);
  }
  return n;
}

export function parseTraceId(raw: string): string {
  const id = raw.trim().toLowerCase();
  if (!TRACE_ID_SHAPE.test(id)) throw new BadRequestException("a trace id is 32 hex characters");
  return id;
}
