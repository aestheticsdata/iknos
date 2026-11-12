import type { SpanEventRow, SpanRow } from "@contracts/traces";
import type { EventFact, RawEventFact, RawFact, SpanFact } from "../interfaces/ai-run-types";

/**
 * Spans as the AI-run reads see them (IKN-91): from the raw facts query, or from a detail row whose
 * `attrs` are already parsed. Pure, and lenient — a value of the wrong type is `null`, never a throw,
 * because the attributes come from browsers.
 */

/** The `officina.*` and GenAI keys the reads extract. */
export const FACT_ATTR = {
  agentName: "gen_ai.agent.name",
  attempt: "officina.attempt",
  nodeId: "officina.node.id",
  nodeKind: "officina.node.kind",
  /** OPI-36 moved it to the conventions' key; runs sent before keep Officina's own. */
  promptVersion: "gen_ai.prompt.version",
  legacyPromptVersion: "officina.prompt.version",
  timeToFirstChunk: "gen_ai.response.time_to_first_chunk",
  pipelineVersion: "officina.pipeline.version",
  gatePass: "officina.gate.pass",
  decision: "officina.human.decision",
  runStatus: "officina.run.status",
  firstTokenMs: "officina.first_token_ms",
  tokensPerSecond: "officina.tokens_per_second",
  loopTarget: "officina.loop.target",
  evaluationName: "gen_ai.evaluation.name",
  evaluationLabel: "gen_ai.evaluation.score.label",
  ruleIndex: "officina.gate.rule_index",
} as const;

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || value === "null") return null;
  if (typeof value === "boolean") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** JSON's `true`/`false` as unquoted text, or SQL's 1/0 as whatever numeric type the driver chose (bigint included). */
function bool(value: unknown): boolean | null {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  if (typeof value === "bigint" || typeof value === "number" || value === "1" || value === "0") {
    const n = Number(value);
    if (n === 1) return true;
    if (n === 0) return false;
  }
  return null;
}

function text(value: unknown): string | null {
  if (typeof value !== "string" || value === "" || value === "null") return null;
  return value;
}

export function factFromRaw(raw: RawFact): SpanFact {
  return {
    traceId: raw.traceId,
    service: raw.service,
    spanId: raw.spanId,
    parentSpanId: raw.parentSpanId,
    name: raw.name,
    startUs: num(raw.startUs) ?? 0,
    durationUs: num(raw.durationUs) ?? 0,
    statusCode: num(raw.statusCode) ?? 0,
    model: text(raw.model),
    inputTokens: num(raw.inputTokens),
    outputTokens: num(raw.outputTokens),
    agentName: text(raw.agentName),
    nodeId: text(raw.nodeId),
    nodeKind: text(raw.nodeKind),
    attempt: num(raw.attempt),
    promptVersion: num(raw.promptVersion),
    pipelineVersion: num(raw.pipelineVersion),
    gatePass: bool(raw.gatePass),
    decision: text(raw.decision),
    runStatus: text(raw.runStatus),
    firstTokenMs: num(raw.firstTokenMs),
    tokensPerSecond: num(raw.tokensPerSecond),
    loopTarget: text(raw.loopTarget),
    hasContent: bool(raw.hasContent) === true,
    contentUntilUs: raw.contentUntilUs instanceof Date ? raw.contentUntilUs.getTime() * 1000 : null,
  };
}

const secondsToMs = (seconds: number | null): number | null => (seconds === null ? null : seconds * 1000);

/** The same facts from a detail row, so the detail's summary is read by the very same `readRun`. */
export function factFromRow(traceId: string, row: SpanRow): SpanFact {
  const attrs = row.attrs ?? {};
  return {
    traceId,
    service: row.service,
    spanId: row.spanId,
    parentSpanId: row.parentSpanId,
    name: row.name,
    startUs: row.startUs,
    durationUs: row.durationUs,
    statusCode: row.statusCode,
    model: row.genAiModel,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    agentName: text(attrs[FACT_ATTR.agentName]),
    nodeId: text(attrs[FACT_ATTR.nodeId]),
    nodeKind: text(attrs[FACT_ATTR.nodeKind]),
    attempt: num(attrs[FACT_ATTR.attempt]),
    promptVersion: num(attrs[FACT_ATTR.promptVersion]) ?? num(attrs[FACT_ATTR.legacyPromptVersion]),
    pipelineVersion: num(attrs[FACT_ATTR.pipelineVersion]),
    gatePass: bool(attrs[FACT_ATTR.gatePass]),
    decision: text(attrs[FACT_ATTR.decision]),
    runStatus: text(attrs[FACT_ATTR.runStatus]),
    firstTokenMs: num(attrs[FACT_ATTR.firstTokenMs]) ?? secondsToMs(num(attrs[FACT_ATTR.timeToFirstChunk])),
    tokensPerSecond: num(attrs[FACT_ATTR.tokensPerSecond]),
    loopTarget: text(attrs[FACT_ATTR.loopTarget]),
    hasContent: row.contentDays !== null,
    contentUntilUs: row.contentUntilUs,
  };
}

export function eventFromRaw(raw: RawEventFact): EventFact {
  return {
    traceId: raw.traceId,
    spanId: raw.spanId,
    timeUs: num(raw.timeUs) ?? 0,
    name: raw.name,
    evaluation: text(raw.evaluation),
    label: text(raw.label),
    ruleIndex: num(raw.ruleIndex),
    decision: text(raw.decision),
  };
}

/** The same from a detail row's events, so the detail's summary sees what the list saw. */
export function eventsFromRow(traceId: string, row: SpanRow): EventFact[] {
  return row.events.map((event: SpanEventRow) => {
    const attrs = event.attrs ?? {};
    return {
      traceId,
      spanId: row.spanId,
      timeUs: event.timeUs,
      name: event.name,
      evaluation: text(attrs[FACT_ATTR.evaluationName]),
      label: text(attrs[FACT_ATTR.evaluationLabel]),
      ruleIndex: num(attrs[FACT_ATTR.ruleIndex]),
      decision: text(attrs[FACT_ATTR.decision]),
    };
  });
}
