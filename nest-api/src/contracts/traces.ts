import type { AiRunSummary } from "./ai-runs";
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
  /** When the span's content goes (Unix µs), `null` when none was kept (IKN-92). */
  contentUntilUs: number | null;
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
  /** The run read for meaning (IKN-92); `null` when the window holds none of its spans. */
  summary: AiRunSummary | null;
  spans: SpanRow[];
  /** The trace has more spans than one response carries (2 000). */
  truncated: boolean;
  meta: Meta;
};
