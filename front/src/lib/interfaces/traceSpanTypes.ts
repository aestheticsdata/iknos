import type { AiRunSummary } from "@lib/interfaces/aiRunTypes";
import type { Meta } from "@lib/logTypes";

/**
 * What the OTLP trace routes return (IKN-87), restated — the authoritative copy is
 * `nest-api/src/contracts/traces.ts`, like every other contract in this front end.
 *
 * Not the log view's `Trace`: that one is the lines that happened to share a `trace.id`, drawn flat
 * on purpose. These are real spans, each naming its parent, and they are drawn as the tree they are.
 * Times are Unix microseconds.
 */

/** Mirrors `contracts/traces.ts` — what became of a span's content (IKN-87 v2). */
export const CONTENT_STATE = { retained: "retained", expired: "expired", none: "none" } as const;
export type ContentState = (typeof CONTENT_STATE)[keyof typeof CONTENT_STATE];

/** The span events the view reads, by their OpenTelemetry / Officina names (IKN-87 v2). */
export const TRACE_EVENT = {
  evaluation: "gen_ai.evaluation.result",
  humanFeedback: "officina.human.feedback",
} as const;

/** The attributes those events carry, metadata and content alike. */
export const TRACE_EVENT_ATTR = {
  evaluationName: "gen_ai.evaluation.name",
  evaluationLabel: "gen_ai.evaluation.score.label",
  evaluationScore: "gen_ai.evaluation.score.value",
  evaluationExplanation: "gen_ai.evaluation.explanation",
  ruleIndex: "officina.gate.rule_index",
  decision: "officina.human.decision",
  nodeId: "officina.node.id",
  note: "officina.human.note",
  edit: "officina.human.edit",
} as const;

/** `gen_ai.evaluation.score.label`. Anything else a sender writes reads as `other`. */
export const EVALUATION_VERDICT = { pass: "pass", fail: "fail", other: "other" } as const;
export type EvaluationVerdict = (typeof EVALUATION_VERDICT)[keyof typeof EVALUATION_VERDICT];

/** OTLP `Status.code`, as each span carries it. */
export const SPAN_STATUS_CODE = { unset: 0, ok: 1, error: 2 } as const;

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
  events: SpanEventRow[];
  content: Record<string, unknown> | null;
  contentState: ContentState;
  contentDays: number | null;
  /** When its content goes, Unix µs; `null` when none was kept (IKN-92). */
  contentUntilUs: number | null;
};

/** Mirrors `contracts/traces.ts`. */
export type SpanEventRow = {
  timeUs: number;
  name: string;
  attrs: Record<string, unknown> | null;
  content: Record<string, unknown> | null;
};

/** Mirrors `contracts/traces.ts`. */
export type TraceDetail = {
  traceId: string;
  /** The run read for meaning (IKN-92); `null` when no span of it was found. */
  summary: AiRunSummary | null;
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

/** One gate evaluation, read off a `gen_ai.evaluation.result` event. */
export type Evaluation = {
  timeUs: number;
  name: string;
  verdict: EvaluationVerdict;
  /** The label as sent, for a verdict of `other`. */
  label: string | null;
  score: number | null;
  ruleIndex: number | null;
  /** Content: present only while the span's content is retained. */
  explanation: string | null;
};

/** One human decision, read off an `officina.human.feedback` event. */
export type HumanFeedback = {
  timeUs: number;
  decision: string;
  nodeId: string | null;
  /** Content, like the evaluation's explanation. */
  note: string | null;
  edit: string | null;
};

/** What a waterfall row marks: how many gates passed and failed on the span, and how many decisions. */
export type ReviewMarks = {
  passed: number;
  failed: number;
  feedback: number;
};
