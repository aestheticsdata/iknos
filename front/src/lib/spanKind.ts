import { SPAN_KIND } from "@lib/interfaces/spanKindTypes";
import { SPAN_STATUS_CODE } from "@lib/interfaces/traceSpanTypes";

import type { Tone } from "@components/ui/surface";
import type { SpanKind } from "@lib/interfaces/spanKindTypes";
import type { SpanRow } from "@lib/interfaces/traceSpanTypes";

/**
 * What an Officina span stands for (IKN-92), read from its shape — `buildTrace`'s run › node ›
 * attempt › `chat <model>` | `gate.verdict` | `execute_tool sandbox` | `human.review`, as OPI-36
 * exports it under the GenAI conventions (`gen_ai.operation.name` names the run, the calls and the
 * tool). Pure.
 *
 * The kind is drawn as a chip and a bar colour; a failed span keeps the error colour *and* its
 * "failed" label, so the state never rests on colour alone.
 */

/** The attribute keys Officina writes — `packages/trace/src/constants.ts`. */
export const OFFICINA = {
  nodeId: "officina.node.id",
  nodeKind: "officina.node.kind",
  attempt: "officina.attempt",
  promptVersion: "gen_ai.prompt.version",
  /** Before OPI-36. */
  legacyPromptVersion: "officina.prompt.version",
  timeToFirstChunk: "gen_ai.response.time_to_first_chunk",
  agentName: "gen_ai.agent.name",
  attempts: "officina.node.attempts",
  pipelineVersion: "officina.pipeline.version",
  cacheHit: "officina.cache.hit",
  gatePass: "officina.gate.pass",
  gateScore: "officina.gate.score",
  gateReasons: "officina.gate.reasons",
  decision: "officina.human.decision",
  runStatus: "officina.run.status",
  firstTokenMs: "officina.first_token_ms",
  tokensPerSecond: "officina.tokens_per_second",
  loopTarget: "officina.loop.target",
  provider: "gen_ai.provider.name",
  modelLoadMs: "officina.model.load_ms",
  gpuVendor: "officina.gpu.vendor",
} as const;

/** The content keys a model call's prompt and response arrive under — `span.content`, while retained. */
export const CONTENT_KEY = {
  system: "gen_ai.system_instructions",
  input: "gen_ai.input.messages",
  output: "gen_ai.output.messages",
} as const;

/** `gen_ai.operation.name` values Officina sends. */
export const OPERATION = {
  chat: "chat",
  invokeWorkflow: "invoke_workflow",
  executeTool: "execute_tool",
} as const;

export const SPAN_NAME = {
  humanReview: "human.review",
  /** Before OPI-36 the sandbox span had its own name. */
  legacySandbox: "sandbox.exec",
} as const;

export const HUMAN_GATE_KIND = "human-gate";

/** Bar ink per kind: steps info, model calls the accent, checks warn — the design's legend. */
export const KIND_TONE: Record<SpanKind, Tone> = {
  [SPAN_KIND.run]: "neutral",
  [SPAN_KIND.step]: "info",
  [SPAN_KIND.gate]: "warn",
  [SPAN_KIND.attempt]: "neutral",
  [SPAN_KIND.model]: "ok",
  [SPAN_KIND.tool]: "neutral",
  [SPAN_KIND.verdict]: "warn",
  [SPAN_KIND.human]: "info",
  [SPAN_KIND.other]: "neutral",
};

export const attrOf = (span: SpanRow, key: string): unknown => span.attrs?.[key];

export const attrNumber = (span: SpanRow, key: string): number | null => {
  const value = attrOf(span, key);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

export const attrString = (span: SpanRow, key: string): string | null => {
  const value = attrOf(span, key);
  return typeof value === "string" && value !== "" ? value : null;
};

const isGateKind = (nodeKind: string): boolean => nodeKind.endsWith("-gate") && nodeKind !== HUMAN_GATE_KIND;

export const isNode = (span: SpanRow): boolean =>
  attrString(span, OFFICINA.nodeId) !== null && attrString(span, OFFICINA.nodeKind) !== null;

/** A gate's verdict: it says whether it passed, and is neither a node nor an attempt. */
export const isVerdict = (span: SpanRow): boolean =>
  typeof attrOf(span, OFFICINA.gatePass) === "boolean" && !isNode(span) && attrNumber(span, OFFICINA.attempt) === null;

export function spanKindOf(span: SpanRow): SpanKind {
  if (span.genAiOperation === OPERATION.executeTool || span.name === SPAN_NAME.legacySandbox) return SPAN_KIND.tool;
  if (isVerdict(span)) return SPAN_KIND.verdict;
  if (span.name === SPAN_NAME.humanReview) return SPAN_KIND.human;
  const nodeKind = attrString(span, OFFICINA.nodeKind);
  if (isNode(span) && nodeKind !== null) return isGateKind(nodeKind) ? SPAN_KIND.gate : SPAN_KIND.step;
  if (attrNumber(span, OFFICINA.attempt) !== null) return SPAN_KIND.attempt;
  if (span.genAiOperation === OPERATION.invokeWorkflow || span.parentSpanId === null) return SPAN_KIND.run;
  if (span.genAiOperation === OPERATION.chat || span.genAiModel !== null) return SPAN_KIND.model;
  return SPAN_KIND.other;
}

/** The prompt version an attempt ran: the conventions' key, else Officina's own from before OPI-36. */
export const promptVersionOf = (span: SpanRow): number | null =>
  attrNumber(span, OFFICINA.promptVersion) ?? attrNumber(span, OFFICINA.legacyPromptVersion);

/** Time to first token in ms: Officina's own, else the conventions' seconds. */
export function firstTokenMsOf(span: SpanRow): number | null {
  const ms = attrNumber(span, OFFICINA.firstTokenMs);
  if (ms !== null) return ms;
  const seconds = attrNumber(span, OFFICINA.timeToFirstChunk);
  return seconds === null ? null : seconds * 1000;
}

export const isFailed = (span: SpanRow): boolean => span.statusCode === SPAN_STATUS_CODE.error;

/** The bar's tone: a failure is red whatever the kind. */
export const kindTone = (span: SpanRow): Tone => (isFailed(span) ? "error" : KIND_TONE[spanKindOf(span)]);

/** Parent chains longer than this are a cycle or garbage. */
const MAX_DEPTH = 64;

/** The node a span belongs to — itself when it is one — or `null` above every node. */
export function nodeOf(span: SpanRow, byId: Map<string, SpanRow>): SpanRow | null {
  let cursor: SpanRow | undefined = span;
  for (let depth = 0; cursor && depth < MAX_DEPTH; depth++) {
    if (isNode(cursor)) return cursor;
    cursor = cursor.parentSpanId ? byId.get(cursor.parentSpanId) : undefined;
  }
  return null;
}

export const spansById = (spans: SpanRow[]): Map<string, SpanRow> => new Map(spans.map((span) => [span.spanId, span]));
