import { RUN_STATE } from "@lib/interfaces/aiRunTypes";
import { RUN_EVENT, SPAN_KIND } from "@lib/interfaces/spanKindTypes";
import { EVALUATION_VERDICT } from "@lib/interfaces/traceSpanTypes";
import { evaluationsOf, feedbackOf } from "@lib/spanEvents";
import {
  attrNumber,
  attrOf,
  attrString,
  isNode,
  isVerdict,
  nodeOf,
  OFFICINA,
  spanKindOf,
  spansById,
} from "@lib/spanKind";

import type { GateVerdict, GateView, GenAiMessage, RunEvent } from "@lib/interfaces/spanKindTypes";
import type { SpanRow } from "@lib/interfaces/traceSpanTypes";
import type { CONTENT_KEY } from "@lib/spanKind";

/**
 * What the run detail's inspector tabs read out of a run's spans (IKN-92): its gates and their
 * verdicts, the moments worth an event line, and a model call's captured conversation. Pure.
 */

/** The attempt a span belongs to — its own `officina.attempt`, else its parent's. */
function attemptOf(span: SpanRow, byId: Map<string, SpanRow>): number | null {
  const own = attrNumber(span, OFFICINA.attempt);
  if (own !== null) return own;
  const parent = span.parentSpanId ? byId.get(span.parentSpanId) : undefined;
  return parent ? attrNumber(parent, OFFICINA.attempt) : null;
}

/**
 * What a verdict gave as reasons. OPI-36 sends one `gen_ai.evaluation.result` per broken rule, its
 * explanation as content: while the content is kept, the reasons are those texts in rule order;
 * after it is purged, or at the metadata level, only the count on the span is left.
 */
function reasonsOf(span: SpanRow): GateVerdict["reasons"] {
  const explained = evaluationsOf(span)
    .filter((evaluation) => evaluation.ruleIndex !== null && evaluation.explanation !== null)
    .sort((a, b) => (a.ruleIndex ?? 0) - (b.ruleIndex ?? 0))
    .map((evaluation) => evaluation.explanation as string);
  if (explained.length > 0) return explained;
  const value = attrOf(span, OFFICINA.gateReasons);
  if (typeof value === "number") return value;
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return null;
}

/**
 * Gates for a sender whose verdicts are only `gen_ai.evaluation.result` events, on whatever span:
 * one gate per evaluation name, its overall events in order. Officina's verdict spans win when
 * there are any — they place the gate in the tree.
 */
function gatesFromEvents(spans: SpanRow[]): GateView[] {
  const gates = new Map<string, GateView>();
  for (const span of spans) {
    for (const evaluation of evaluationsOf(span)) {
      if (evaluation.ruleIndex !== null || evaluation.verdict === EVALUATION_VERDICT.other) continue;
      const gate = gates.get(evaluation.name) ?? { node: span, passed: true, verdicts: [], loopTarget: null };
      gate.verdicts.push({
        spanId: span.spanId,
        attempt: null,
        passed: evaluation.verdict === EVALUATION_VERDICT.pass,
        score: evaluation.score,
        reasons: evaluation.explanation === null ? null : [evaluation.explanation],
      });
      gates.set(evaluation.name, gate);
    }
  }
  for (const gate of gates.values()) gate.passed = gate.verdicts[gate.verdicts.length - 1]?.passed ?? true;
  return [...gates.values()];
}

/** Every automated gate of the run — human gates excluded — in the order they first ran. */
export function gatesOf(spans: SpanRow[]): GateView[] {
  const byId = spansById(spans);
  const gates = new Map<string, GateView>();
  for (const node of spans) {
    if (spanKindOf(node) === SPAN_KIND.gate)
      gates.set(node.spanId, { node, passed: true, verdicts: [], loopTarget: null });
  }
  const ordered = [...spans].sort((a, b) => a.startUs - b.startUs);
  for (const span of ordered) {
    const node = nodeOf(span, byId);
    const gate = node ? gates.get(node.spanId) : undefined;
    if (!gate) continue;
    gate.loopTarget ??= attrString(span, OFFICINA.loopTarget);
    if (!isVerdict(span)) continue;
    gate.verdicts.push({
      spanId: span.spanId,
      attempt: attemptOf(span, byId),
      passed: attrOf(span, OFFICINA.gatePass) === true,
      score: attrNumber(span, OFFICINA.gateScore),
      reasons: reasonsOf(span),
    });
  }
  for (const gate of gates.values()) gate.passed = gate.verdicts[gate.verdicts.length - 1]?.passed ?? true;
  const fromSpans = [...gates.values()].filter((gate) => gate.verdicts.length > 0);
  return fromSpans.length > 0 ? fromSpans.sort((a, b) => a.node.startUs - b.node.startUs) : gatesFromEvents(spans);
}

/**
 * The gates a selection concerns: the gate it sits in; the gates that looped back to the step it
 * sits in; or, for the run itself and anything else, all of them.
 */
export function gatesFor(spans: SpanRow[], selected: SpanRow | null): GateView[] {
  const gates = gatesOf(spans);
  if (selected === null) return gates;
  const node = nodeOf(selected, spansById(spans));
  if (node === null) return gates;
  const own = gates.filter((gate) => gate.node.spanId === node.spanId);
  if (own.length > 0) return own;
  const step = attrString(node, OFFICINA.nodeId);
  return gates.filter((gate) => gate.loopTarget !== null && gate.loopTarget === step);
}

const labelOfNode = (span: SpanRow, byId: Map<string, SpanRow>): string => nodeOf(span, byId)?.name ?? span.name;

/** The run's story in a few lines: start, failed checks, retries, the human decision, the end. */
export function runEvents(spans: SpanRow[]): RunEvent[] {
  const byId = spansById(spans);
  const events: RunEvent[] = [];
  const root = spans.find((span) => span.parentSpanId === null || !byId.has(span.parentSpanId));
  for (const span of spans) {
    const kind = spanKindOf(span);
    if (isVerdict(span) && attrOf(span, OFFICINA.gatePass) === false) {
      events.push({
        atUs: span.startUs + span.durationUs,
        kind: RUN_EVENT.checkFailed,
        spanId: span.spanId,
        subject: labelOfNode(span, byId),
        attempt: attemptOf(span, byId),
        decision: null,
      });
    }
    if (kind === SPAN_KIND.attempt && (attrNumber(span, OFFICINA.attempt) ?? 1) > 1) {
      const node = nodeOf(span, byId);
      if (node && spanKindOf(node) === SPAN_KIND.step) {
        events.push({
          atUs: span.startUs,
          kind: RUN_EVENT.retry,
          spanId: span.spanId,
          subject: node.name,
          attempt: attrNumber(span, OFFICINA.attempt),
          decision: null,
        });
      }
    }
    /* A decision is the feedback event when one was sent, else the review span's own attribute. */
    const feedback = feedbackOf(span);
    for (const item of feedback) {
      events.push({
        atUs: item.timeUs,
        kind: RUN_EVENT.decision,
        spanId: span.spanId,
        subject: labelOfNode(span, byId),
        attempt: null,
        decision: item.decision,
      });
    }
    if (feedback.length === 0 && kind === SPAN_KIND.human && attrString(span, OFFICINA.decision) !== null) {
      events.push({
        atUs: span.startUs + span.durationUs,
        kind: RUN_EVENT.decision,
        spanId: span.spanId,
        subject: labelOfNode(span, byId),
        attempt: null,
        decision: attrString(span, OFFICINA.decision),
      });
    }
  }
  if (root) {
    events.push({
      atUs: root.startUs,
      kind: RUN_EVENT.start,
      spanId: root.spanId,
      subject: attrString(root, OFFICINA.agentName) ?? root.name,
      attempt: null,
      decision: null,
    });
    const running = attrString(root, OFFICINA.runStatus) === RUN_STATE.running;
    events.push({
      atUs: root.startUs + root.durationUs,
      kind: running ? RUN_EVENT.running : RUN_EVENT.end,
      spanId: root.spanId,
      subject: attrString(root, OFFICINA.agentName) ?? root.name,
      attempt: null,
      decision: null,
    });
  }
  return events.sort((a, b) => a.atUs - b.atUs);
}

/** The span's content was captured — the run was traced at `full` — whether or not it is still kept. */
export const hasContent = (span: SpanRow): boolean => span.contentDays !== null;

/** One content key of the span while it is retained (`span.content`), else `undefined`. */
export const contentOf = (span: SpanRow, key: (typeof CONTENT_KEY)[keyof typeof CONTENT_KEY]): unknown =>
  span.content?.[key];

type RawMessage = {
  role?: unknown;
  parts?: unknown;
  content?: unknown;
};

function textOfParts(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) =>
      part && typeof part === "object" && "content" in part ? String((part as { content: unknown }).content) : "",
    )
    .filter((text) => text !== "")
    .join("\n");
}

/**
 * A captured conversation, per the GenAI conventions: a JSON array of `{ role, parts: [{ content }] }`
 * — older senders put a `content` string on the message itself. Anything else is one message
 * holding the raw text, so a sender's odd shape is shown, not lost.
 */
export function messagesOf(value: unknown): GenAiMessage[] {
  if (value === undefined || value === null) return [];
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [{ position: 0, role: "", text: value }];
    }
  }
  if (!Array.isArray(parsed))
    return [{ position: 0, role: "", text: typeof value === "string" ? value : JSON.stringify(value) }];
  return parsed.map((item: RawMessage, position) => ({
    position,
    role: typeof item?.role === "string" ? item.role : "",
    text: typeof item?.content === "string" ? item.content : textOfParts(item?.parts),
  }));
}

/** The step nodes of the run, for the summary's "n steps". */
export const stepCount = (spans: SpanRow[]): number =>
  spans.filter((span) => isNode(span) && spanKindOf(span) === SPAN_KIND.step).length;
