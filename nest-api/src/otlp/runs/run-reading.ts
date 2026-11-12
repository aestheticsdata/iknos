import { CHECKS, REVIEW, RUN_STATE, TELEMETRY } from "@contracts/ai-runs";
import { EVALUATION_LABEL, EVENT_NAME } from "../otlp-limits";

import type { Checks, Review } from "@contracts/ai-runs";
import type { EventFact, GateReading, RunReading, SpanFact, StepReading } from "../interfaces/ai-run-types";

/**
 * Reading one Officina run for meaning (IKN-91). Pure: the spans of one trace in, the run's row and
 * its gates and steps out.
 *
 * The shape is `buildTrace`'s (`~/dev/opifex/packages/trace/src/spans/buildTrace.ts`): run › node ›
 * attempt › `chat <model>` | `gate.verdict` | `sandbox.exec` | `human.review`. Node spans are the
 * ones carrying `officina.node.id` and `officina.node.kind`; every other span belongs to the
 * nearest node above it.
 */

/** Officina's span names — the vocabulary this reader keys on. */
export const SPAN_NAME = {
  humanReview: "human.review",
} as const;

/** A human gate emits a verdict too, but it is the review, not an automated check. */
export const HUMAN_GATE_KIND = "human-gate";

/** `officina.run.status` while the run is going. */
export const OFFICINA_RUNNING = "running";

const REVIEWS: readonly string[] = [REVIEW.approve, REVIEW.edit, REVIEW.reject];

/** Parent chains longer than this are a cycle or garbage; the walk stops rather than loops. */
const MAX_DEPTH = 64;

const isNodeSpan = (span: SpanFact): boolean => span.nodeId !== null && span.nodeKind !== null;

type Tree = {
  byId: Map<string, SpanFact>;
  /** Spans that have a child naming a model: Officina's attempt spans, which copy their call's usage. */
  callParents: Set<string>;
};

/**
 * A model call: a span naming a model with no child that names one. Officina's attempt span repeats
 * its `chat <model>` child's model and tokens; counting only the leaf keeps them from counting twice,
 * and holds for any sender that nests its calls the same way — or not at all.
 */
const isCall = (tree: Tree, span: SpanFact): boolean => span.model !== null && !tree.callParents.has(span.spanId);

/** The node a span belongs to: itself when it is one, else the nearest node above it. */
function nodeOf(tree: Tree, span: SpanFact): SpanFact | null {
  let cursor: SpanFact | undefined = span;
  for (let depth = 0; cursor && depth < MAX_DEPTH; depth++) {
    if (isNodeSpan(cursor)) return cursor;
    cursor = cursor.parentSpanId ? tree.byId.get(cursor.parentSpanId) : undefined;
  }
  return null;
}

/** Spans grouped by the node they belong to, keyed by the node's span id. */
function groupByNode(tree: Tree, spans: SpanFact[]): Map<string, SpanFact[]> {
  const groups = new Map<string, SpanFact[]>();
  for (const span of spans) {
    const node = nodeOf(tree, span);
    if (!node) continue;
    const list = groups.get(node.spanId) ?? [];
    list.push(span);
    groups.set(node.spanId, list);
  }
  return groups;
}

/**
 * A verdict: a span carrying `officina.gate.pass` that is neither a node nor an attempt. Officina
 * names it `gate.verdict`, or — for the sandbox running the tests — `execute_tool sandbox`; the
 * attribute, not the name, is what makes it one.
 */
const isVerdict = (span: SpanFact): boolean => span.gatePass !== null && span.attempt === null && span.nodeId === null;

function readGate(node: SpanFact, members: SpanFact[]): GateReading {
  const verdicts = members.filter(isVerdict).sort((a, b) => a.startUs - b.startUs);
  const last = verdicts[verdicts.length - 1];
  return {
    nodeId: node.nodeId ?? node.spanId,
    label: node.name,
    passed: last?.gatePass === true,
    failures: verdicts.filter((span) => span.gatePass === false).length,
    loopTarget: members.find((span) => span.loopTarget !== null)?.loopTarget ?? null,
  };
}

/** Tokens per model over a set of chat spans; the heaviest model wins. */
function heaviestModel(chats: SpanFact[]): string | null {
  const byModel = new Map<string, number>();
  for (const span of chats) {
    if (!span.model) continue;
    byModel.set(span.model, (byModel.get(span.model) ?? 0) + (span.inputTokens ?? 0) + (span.outputTokens ?? 0) + 1);
  }
  let best: string | null = null;
  let weight = -1;
  for (const [model, w] of byModel) {
    if (w > weight || (w === weight && best !== null && model < best)) {
      best = model;
      weight = w;
    }
  }
  return best;
}

function readStep(tree: Tree, node: SpanFact, members: SpanFact[]): StepReading {
  const chats = members.filter((span) => isCall(tree, span));
  const versions = members.map((span) => span.promptVersion).filter((v): v is number => v !== null);
  return {
    nodeId: node.nodeId ?? node.spanId,
    label: node.name,
    durationUs: node.durationUs,
    promptVersion: versions.length > 0 ? Math.max(...versions) : null,
    model: heaviestModel(chats),
    tokens: chats.reduce((a, span) => a + (span.inputTokens ?? 0) + (span.outputTokens ?? 0), 0),
    firstTokenMs: chats.map((span) => span.firstTokenMs).filter((v): v is number => v !== null),
    tokensPerSecond: chats.map((span) => span.tokensPerSecond).filter((v): v is number => v !== null),
  };
}

function checksOf(gates: GateReading[], running: boolean): Checks {
  if (running) return CHECKS.pending;
  if (gates.length === 0) return CHECKS.none;
  return gates.every((gate) => gate.passed) ? CHECKS.passed : CHECKS.failed;
}

/** The last decision: the human-review span's, else the last `officina.human.feedback` event's. */
function reviewOf(spans: SpanFact[], events: EventFact[]): Review {
  const reviews = spans
    .filter((span) => span.name === SPAN_NAME.humanReview && span.decision !== null)
    .sort((a, b) => a.startUs - b.startUs);
  const feedback = events
    .filter((event) => event.name === EVENT_NAME.humanFeedback && event.decision !== null)
    .sort((a, b) => a.timeUs - b.timeUs);
  const decision = reviews[reviews.length - 1]?.decision ?? feedback[feedback.length - 1]?.decision;
  return decision && REVIEWS.includes(decision) ? (decision as Review) : REVIEW.none;
}

/**
 * Gates read from `gen_ai.evaluation.result` events, for a sender whose verdicts are only events —
 * the GenAI conventions' own way. Each evaluation name is a gate; its overall events (those without
 * a rule index) are its verdicts in order, the last one deciding. Officina sends both the verdict
 * spans and the events, and the spans win: they place the gate in the tree.
 */
function gatesFromEvents(events: EventFact[]): GateReading[] {
  const overall = events
    .filter((event) => event.name === EVENT_NAME.evaluation && event.ruleIndex === null && event.label !== null)
    .sort((a, b) => a.timeUs - b.timeUs);
  const byName = new Map<string, EventFact[]>();
  for (const event of overall) {
    const key = event.evaluation ?? event.spanId;
    const list = byName.get(key) ?? [];
    list.push(event);
    byName.set(key, list);
  }
  return [...byName.entries()].map(([name, verdicts]) => ({
    nodeId: name,
    label: name,
    passed: verdicts[verdicts.length - 1].label === EVALUATION_LABEL.pass,
    failures: verdicts.filter((event) => event.label === EVALUATION_LABEL.fail).length,
    loopTarget: null,
  }));
}

const earliest = (values: Array<number | null>): number | null => {
  const known = values.filter((v): v is number => v !== null);
  return known.length === 0 ? null : Math.min(...known);
};

/** The root: the earliest span without a parent in the trace, else the earliest span. */
function rootOf(tree: Tree, spans: SpanFact[]): SpanFact {
  const sorted = [...spans].sort((a, b) => a.startUs - b.startUs);
  return sorted.find((span) => !span.parentSpanId || !tree.byId.has(span.parentSpanId)) ?? sorted[0];
}

/** One run. `spans` are every span of one trace, in any order, at least one; `events` its evaluations and feedback. */
export function readRun(spans: SpanFact[], events: EventFact[] = []): RunReading {
  const tree: Tree = {
    byId: new Map(spans.map((span) => [span.spanId, span])),
    callParents: new Set(
      spans
        .filter((span) => span.model !== null && span.parentSpanId !== null)
        .map((span) => span.parentSpanId as string),
    ),
  };
  const root = rootOf(tree, spans);
  const groups = groupByNode(tree, spans);
  const nodes = spans.filter(isNodeSpan).sort((a, b) => a.startUs - b.startUs);

  const gates: GateReading[] = [];
  const steps: StepReading[] = [];
  for (const node of nodes) {
    const members = groups.get(node.spanId) ?? [];
    const hasVerdict = members.some(isVerdict);
    if (hasVerdict && node.nodeKind !== HUMAN_GATE_KIND) gates.push(readGate(node, members));
    else steps.push(readStep(tree, node, members));
  }

  if (gates.length === 0) gates.push(...gatesFromEvents(events));

  const start = Math.min(...spans.map((span) => span.startUs));
  const end = Math.max(...spans.map((span) => span.startUs + span.durationUs));
  const running = root.runStatus === OFFICINA_RUNNING;
  const chats = spans.filter((span) => isCall(tree, span));

  return {
    summary: {
      traceId: root.traceId,
      service: root.service,
      pipeline: root.agentName ?? root.name,
      pipelineVersion: root.pipelineVersion,
      startUs: start,
      durationUs: Math.max(0, end - start),
      spanCount: spans.length,
      steps: steps.length,
      state: running ? RUN_STATE.running : RUN_STATE.completed,
      checks: checksOf(gates, running),
      failedGates: gates.filter((gate) => !gate.passed).length,
      review: reviewOf(spans, events),
      telemetry: spans.some((span) => span.hasContent) ? TELEMETRY.full : TELEMETRY.metadata,
      contentUntilUs: earliest(spans.map((span) => span.contentUntilUs)),
      inputTokens: chats.reduce((a, span) => a + (span.inputTokens ?? 0), 0),
      outputTokens: chats.reduce((a, span) => a + (span.outputTokens ?? 0), 0),
      prompts: steps
        .filter((step) => step.promptVersion !== null)
        .map((step) => `${step.nodeId}@v${step.promptVersion}`),
      model: heaviestModel(chats),
    },
    gates,
    steps,
  };
}

function groupByTrace<T extends { traceId: string }>(items: T[]): Map<string, T[]> {
  const byTrace = new Map<string, T[]>();
  for (const item of items) {
    const list = byTrace.get(item.traceId) ?? [];
    list.push(item);
    byTrace.set(item.traceId, list);
  }
  return byTrace;
}

/** Facts of many traces → one reading per trace, newest first. */
export function readRuns(facts: SpanFact[], events: EventFact[] = []): RunReading[] {
  const eventsByTrace = groupByTrace(events);
  return [...groupByTrace(facts).entries()]
    .map(([traceId, spans]) => readRun(spans, eventsByTrace.get(traceId) ?? []))
    .sort((a, b) => b.summary.startUs - a.summary.startUs);
}
