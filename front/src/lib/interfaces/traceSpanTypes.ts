import type { Meta } from "@lib/logTypes";

/**
 * What the OTLP trace routes return (IKN-87), restated — the authoritative copy is
 * `nest-api/src/contracts/traces.ts`, like every other contract in this front end.
 *
 * Not the log view's `Trace`: that one is the lines that happened to share a `trace.id`, drawn flat
 * on purpose. These are real spans, each naming its parent, and they are drawn as the tree they are.
 * Times are Unix microseconds.
 */

/** Mirrors `contracts/traces.ts`. */
export const TRACE_STATUS = { unset: "unset", ok: "ok", error: "error" } as const;
export type TraceStatus = (typeof TRACE_STATUS)[keyof typeof TRACE_STATUS];

/** OTLP `Status.code`, as each span carries it. */
export const SPAN_STATUS_CODE = { unset: 0, ok: 1, error: 2 } as const;

/** Mirrors `contracts/traces.ts`. */
export type TraceSummary = {
  traceId: string;
  service: string;
  rootName: string;
  startUs: number;
  durationUs: number;
  spanCount: number;
  status: TraceStatus;
  inputTokens: number | null;
  outputTokens: number | null;
  models: string[];
};

/** Mirrors `contracts/traces.ts`. */
export type TraceList = {
  traces: TraceSummary[];
  truncated: boolean;
  meta: Meta;
};

/** Mirrors `contracts/traces.ts`. */
export type SpanRow = {
  spanId: string;
  parentSpanId: string | null;
  service: string;
  name: string;
  kind: number;
  startUs: number;
  durationUs: number;
  statusCode: number;
  statusMessage: string | null;
  genAiOperation: string | null;
  genAiModel: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  attrs: Record<string, unknown> | null;
};

/** Mirrors `contracts/traces.ts`. */
export type TraceDetail = {
  traceId: string;
  spans: SpanRow[];
  truncated: boolean;
  meta: Meta;
};

/** A span with its children, as `buildSpanTree` assembles them from `parentSpanId`. */
export type SpanNode = {
  span: SpanRow;
  children: SpanNode[];
};

/** One line of the waterfall: the span, how deep it sits, and whether its parent is missing. */
export type WaterfallLine = {
  span: SpanRow;
  depth: number;
  /** Its parent id names a span this trace does not hold — dropped, rejected, or outside the window. */
  orphan: boolean;
};

/** The trace's extent on its own clock — the waterfall's x axis. */
export type Timeline = {
  startUs: number;
  durationUs: number;
};

/** A bar's place on that axis, in percent of the drawing. */
export type BarBox = {
  leftPct: number;
  widthPct: number;
};

/** One axis label: where it sits, in percent, and the offset from the trace's start it names. */
export type AxisTick = {
  pct: number;
  offsetUs: number;
};
