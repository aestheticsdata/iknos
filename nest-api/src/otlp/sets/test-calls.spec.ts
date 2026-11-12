import { CONTENT_STATE } from "@contracts/traces";
import { describe, expect, it } from "vitest";
import { hasInputs, testCalls } from "./test-calls";

import type { SpanRow } from "@contracts/traces";

const span = (over: Partial<SpanRow>): SpanRow => ({
  spanId: "root",
  parentSpanId: null,
  service: "opifex-front",
  name: "invoke_workflow spec-to-code",
  kind: 1,
  startUs: 0,
  durationUs: 10,
  statusCode: 1,
  statusMessage: null,
  genAiOperation: null,
  genAiModel: null,
  inputTokens: null,
  outputTokens: null,
  attrs: null,
  events: [],
  content: null,
  contentState: CONTENT_STATE.none,
  contentDays: null,
  contentUntilUs: null,
  ...over,
});

const RUN = [
  span({}),
  span({
    spanId: "spec",
    parentSpanId: "root",
    name: "Spec",
    startUs: 1,
    attrs: { "officina.node.id": "spec", "officina.node.kind": "llm" },
  }),
  span({
    spanId: "a1",
    parentSpanId: "spec",
    name: "spec #1",
    startUs: 1,
    genAiModel: "m",
    attrs: { "gen_ai.prompt.version": 14 },
  }),
  span({
    spanId: "c1",
    parentSpanId: "a1",
    name: "chat m",
    startUs: 2,
    genAiModel: "m",
    content: {
      "gen_ai.input.messages": '[{"role":"user","parts":[{"type":"text","content":"go"}]}]',
      "gen_ai.output.messages": "done",
    },
    contentState: CONTENT_STATE.retained,
    contentDays: 7,
  }),
  span({
    spanId: "c0",
    parentSpanId: "root",
    name: "chat m",
    startUs: 0.5,
    genAiModel: "m",
    contentState: CONTENT_STATE.expired,
    contentDays: 7,
  }),
];

describe("testCalls", () => {
  it("keeps one entry per call, not per attempt, in start order, with its step and prompt version", () => {
    const calls = testCalls(RUN);

    expect(calls.map((call) => [call.step, call.promptVersion])).toEqual([
      [null, null],
      ["spec", 14],
    ]);
  });

  it("copies the retained content, parsed, and nothing from expired content", () => {
    const [expired, kept] = testCalls(RUN);

    expect(expired).toMatchObject({ input: null, output: null });
    expect(kept.input).toEqual([{ role: "user", parts: [{ type: "text", content: "go" }] }]);
    expect(kept.output).toBe("done");
    expect(hasInputs([expired, kept])).toBe(true);
    expect(hasInputs([expired])).toBe(false);
  });
});
