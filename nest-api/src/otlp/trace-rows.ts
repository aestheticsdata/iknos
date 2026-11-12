import { readJsonColumn } from "@common/json-column";
import { TRACE_STATUS } from "@contracts/traces";
import { BadRequestException } from "@nestjs/common";

import type { SpanRow, TraceStatus, TraceSummary } from "@contracts/traces";
import type { Span } from "@generated/prisma/client";
import type { RawTraceRow } from "./interfaces/otlp-types";

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
  };
}

export function toSpanRow(span: Span): SpanRow {
  return {
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    service: span.service,
    name: span.name,
    kind: span.kind,
    startUs: Number(span.startUs),
    durationUs: Number(span.durationUs),
    statusCode: span.statusCode,
    statusMessage: span.statusMessage,
    genAiOperation: span.genAiOperation,
    genAiModel: span.genAiModel,
    inputTokens: span.inputTokens,
    outputTokens: span.outputTokens,
    attrs: readJsonColumn(span.attrs),
  };
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
