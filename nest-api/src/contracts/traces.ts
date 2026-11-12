import type { Meta } from "./meta";

/**
 * The AI pipeline traces received over OTLP (IKN-87), as the Traces view reads them.
 *
 * Unlike `Trace` in `trace.ts` — the lines that happened to share a `trace.id` — this **is** a span
 * tree: every span names its parent, because the sender propagated a real span context. The tree
 * is built in the front from `parentSpanId`; the API hands over the flat list in start order.
 *
 * Times are Unix **microseconds** as numbers. A trace's spans can be a few hundred microseconds
 * long under a parent of several seconds, and milliseconds would flatten them to zero-width bars.
 * 2⁵³ µs is the year 2255, so a JSON number holds them exactly.
 */

/** The worst any span of a trace said: `error` if one failed, `ok` if one said so, else `unset`. */
export const TRACE_STATUS = {
  unset: "unset",
  ok: "ok",
  error: "error",
} as const;

export type TraceStatus = (typeof TRACE_STATUS)[keyof typeof TRACE_STATUS];

/**
 * What became of a span's content — prompts, answers, notes (IKN-87 v2). Content is kept apart
 * from the metadata, for as many days as its sender allowed, then purged; the span says which:
 *
 * - `retained` — `content` holds it, under the attribute keys it was sent with;
 * - `expired` — some was kept, and its retention (`contentDays`) has run out;
 * - `none` — none was ever kept: the app sent metadata only, or the server keeps no content.
 */
export const CONTENT_STATE = {
  retained: "retained",
  expired: "expired",
  none: "none",
} as const;

export type ContentState = (typeof CONTENT_STATE)[keyof typeof CONTENT_STATE];

/** One run, one row: what the list needs to choose which one to open. */
export type TraceSummary = {
  traceId: string;
  service: string;
  /** The root span's name — the first span without a parent, else the earliest span's. */
  rootName: string;
  startUs: number;
  durationUs: number;
  spanCount: number;
  status: TraceStatus;
  /** Sums of the GenAI usage columns over the trace; `null` when no span reported any. */
  inputTokens: number | null;
  outputTokens: number | null;
  /** Distinct `gen_ai.request.model` values, sorted. */
  models: string[];
  /** `gen_ai.evaluation.result` events labelled `fail` on the trace's spans (IKN-87 v2). */
  failedEvaluations: number;
  /** `officina.human.feedback` events on the trace's spans (IKN-87 v2). */
  humanFeedback: number;
};

/** `GET /api/traces` — newest first, at most `limit` (default 100, max 500). */
export type TraceList = {
  traces: TraceSummary[];
  /** More traces matched than were returned; the window should be narrowed. */
  truncated: boolean;
  meta: Meta;
};

/** One span as the waterfall draws it. */
export type SpanRow = {
  spanId: string;
  parentSpanId: string | null;
  service: string;
  name: string;
  /** OTLP `SpanKind`, 0–5. */
  kind: number;
  startUs: number;
  durationUs: number;
  /** OTLP `Status.code`: 0 unset, 1 ok, 2 error. */
  statusCode: number;
  /** Content since IKN-87 v2: present only while the span's content is retained. */
  statusMessage: string | null;
  genAiOperation: string | null;
  genAiModel: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  attrs: Record<string, unknown> | null;
  /** The span's events in time order — gate evaluations, human feedback, anything else sent. */
  events: SpanEventRow[];
  /** The span's own content (`gen_ai.input.messages`, …) while retained, else `null`. */
  content: Record<string, unknown> | null;
  contentState: ContentState;
  /** The retention the content was kept for, in days; `null` when none was kept. */
  contentDays: number | null;
};

/** One span event: metadata, and its content while retained. Times are Unix microseconds. */
export type SpanEventRow = {
  timeUs: number;
  name: string;
  attrs: Record<string, unknown> | null;
  /** The event's content keys (`gen_ai.evaluation.explanation`, `officina.human.note`, …), or `null`. */
  content: Record<string, unknown> | null;
};

/** `GET /api/traces/:traceId` — every span of one trace, in start order. */
export type TraceDetail = {
  traceId: string;
  spans: SpanRow[];
  /** The trace has more spans than one response carries (2 000). */
  truncated: boolean;
  meta: Meta;
};
