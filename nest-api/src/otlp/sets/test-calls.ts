import { CONTENT_STATE } from "@contracts/traces";

import type { TestCall } from "@contracts/test-sets";
import type { SpanRow } from "@contracts/traces";

/**
 * A run's model calls as a test set keeps them (IKN-95), pure: one per call span — a span naming a
 * model with no child that names one, so Officina's attempt span, which repeats its call's model,
 * is not a call twice — in start order, with the step and prompt version from the spans above it
 * and the conversation from its retained content.
 */

const KEY = {
  nodeId: "officina.node.id",
  promptVersion: "gen_ai.prompt.version",
  legacyPromptVersion: "officina.prompt.version",
  system: "gen_ai.system_instructions",
  input: "gen_ai.input.messages",
  output: "gen_ai.output.messages",
} as const;

/** Parent chains longer than this are a cycle or garbage. */
const MAX_DEPTH = 64;

const numberAt = (span: SpanRow, key: string): number | null => {
  const value = span.attrs?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

/** The first value `read` finds walking up from `span`, itself included. */
function upward<T>(span: SpanRow, byId: Map<string, SpanRow>, read: (at: SpanRow) => T | null): T | null {
  let cursor: SpanRow | undefined = span;
  for (let depth = 0; cursor && depth < MAX_DEPTH; depth++) {
    const found = read(cursor);
    if (found !== null) return found;
    cursor = cursor.parentSpanId ? byId.get(cursor.parentSpanId) : undefined;
  }
  return null;
}

/** JSON content as it was sent — a string of JSON is parsed, anything else kept as it is. */
function parsed(value: unknown): unknown {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function testCalls(spans: SpanRow[]): TestCall[] {
  const byId = new Map(spans.map((span) => [span.spanId, span]));
  const callParents = new Set(
    spans.filter((span) => span.genAiModel !== null && span.parentSpanId !== null).map((span) => span.parentSpanId),
  );
  return spans
    .filter((span) => span.genAiModel !== null && !callParents.has(span.spanId))
    .sort((a, b) => a.startUs - b.startUs)
    .map((span) => {
      const kept = span.contentState === CONTENT_STATE.retained ? (span.content ?? {}) : {};
      return {
        step: upward(span, byId, (at) => {
          const id = at.attrs?.[KEY.nodeId];
          return typeof id === "string" ? id : null;
        }),
        promptVersion: upward(
          span,
          byId,
          (at) => numberAt(at, KEY.promptVersion) ?? numberAt(at, KEY.legacyPromptVersion),
        ),
        model: span.genAiModel,
        system: parsed(kept[KEY.system]),
        input: parsed(kept[KEY.input]),
        output: parsed(kept[KEY.output]),
      };
    });
}

/** A case can be run again only if at least one call kept what went into it. */
export const hasInputs = (calls: TestCall[]): boolean => calls.some((call) => call.input !== null);
