import { CONTENT_STATE, EVALUATION_VERDICT, TRACE_EVENT, TRACE_EVENT_ATTR } from "@lib/interfaces/traceSpanTypes";

import type {
  Evaluation,
  EvaluationVerdict,
  HumanFeedback,
  ReviewMarks,
  SpanEventRow,
  SpanRow,
} from "@lib/interfaces/traceSpanTypes";

/**
 * Reading a span's events as the two things the Traces view shows (IKN-87 v2): gate evaluations
 * (`gen_ai.evaluation.result`) and human decisions (`officina.human.feedback`).
 *
 * Every field is read defensively — the events come from browsers, and an attribute of the wrong
 * type is an absence here, never a crash in the inspector. Content (an evaluation's explanation, a
 * reviewer's note or edit) is looked for in the event's `content` first, which is where the API
 * puts it while it is retained, then in `attrs`, where a pre-v2 row may still hold it.
 */

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const number = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** An attribute of an event, content before metadata. */
const field = (event: SpanEventRow, key: string): unknown => event.content?.[key] ?? event.attrs?.[key];

const verdictOf = (label: string | null): EvaluationVerdict => {
  if (label === EVALUATION_VERDICT.pass) return EVALUATION_VERDICT.pass;
  if (label === EVALUATION_VERDICT.fail) return EVALUATION_VERDICT.fail;
  return EVALUATION_VERDICT.other;
};

/** The span's gate evaluations, in time order. */
export const evaluationsOf = (span: SpanRow): Evaluation[] =>
  span.events
    .filter((event) => event.name === TRACE_EVENT.evaluation)
    .map((event) => {
      const label = text(field(event, TRACE_EVENT_ATTR.evaluationLabel));
      return {
        timeUs: event.timeUs,
        name: text(field(event, TRACE_EVENT_ATTR.evaluationName)) ?? event.name,
        verdict: verdictOf(label),
        label,
        score: number(field(event, TRACE_EVENT_ATTR.evaluationScore)),
        ruleIndex: number(field(event, TRACE_EVENT_ATTR.ruleIndex)),
        explanation: text(field(event, TRACE_EVENT_ATTR.evaluationExplanation)),
      };
    });

/** The span's human decisions, in time order. A decision with no word reads as the empty string. */
export const feedbackOf = (span: SpanRow): HumanFeedback[] =>
  span.events
    .filter((event) => event.name === TRACE_EVENT.humanFeedback)
    .map((event) => ({
      timeUs: event.timeUs,
      decision: text(field(event, TRACE_EVENT_ATTR.decision)) ?? "",
      nodeId: text(field(event, TRACE_EVENT_ATTR.nodeId)),
      note: text(field(event, TRACE_EVENT_ATTR.note)),
      edit: text(field(event, TRACE_EVENT_ATTR.edit)),
    }));

/** What the waterfall row marks for a span — counts only, so a row stays one line. */
export const reviewMarks = (span: SpanRow): ReviewMarks => {
  const evaluations = evaluationsOf(span);
  return {
    passed: evaluations.filter((e) => e.verdict === EVALUATION_VERDICT.pass).length,
    failed: evaluations.filter((e) => e.verdict === EVALUATION_VERDICT.fail).length,
    feedback: feedbackOf(span).length,
  };
};

/** The span's own content, sorted by key, or nothing when none is retained. */
export const contentEntries = (span: SpanRow): [string, unknown][] =>
  span.contentState === CONTENT_STATE.retained
    ? Object.entries(span.content ?? {}).sort(([a], [b]) => a.localeCompare(b))
    : [];

/**
 * A content value as text to read. The GenAI message keys are JSON *strings* (an array of
 * messages, serialised by the sender); those are re-indented so a conversation reads as one,
 * anything else is shown as sent.
 */
export const contentText = (value: unknown): string => {
  if (typeof value !== "string") return JSON.stringify(value, null, 2);
  const trimmed = value.trimStart();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return value;
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
};
