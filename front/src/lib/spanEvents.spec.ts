import { CONTENT_STATE, EVALUATION_VERDICT, SPAN_STATUS_CODE, TRACE_EVENT } from "@lib/interfaces/traceSpanTypes";
import { describe, expect, it } from "vitest";
import { contentEntries, contentText, evaluationsOf, feedbackOf, reviewMarks } from "./spanEvents";

import type { SpanEventRow, SpanRow } from "@lib/interfaces/traceSpanTypes";

const span = (over: Partial<SpanRow> = {}): SpanRow => ({
  spanId: "00f067aa0ba902b7",
  parentSpanId: null,
  service: "opifex-front",
  name: "llm.generate",
  kind: 1,
  startUs: 1_000_000,
  durationUs: 4_000_000,
  statusCode: SPAN_STATUS_CODE.ok,
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
  ...over,
});

const evaluation = (label: unknown, content: Record<string, unknown> | null = null): SpanEventRow => ({
  timeUs: 2_000_000,
  name: TRACE_EVENT.evaluation,
  attrs: {
    "gen_ai.evaluation.name": "schema",
    "gen_ai.evaluation.score.label": label,
    "gen_ai.evaluation.score.value": 0,
    "officina.gate.rule_index": 2,
  },
  content,
});

const feedback: SpanEventRow = {
  timeUs: 3_000_000,
  name: TRACE_EVENT.humanFeedback,
  attrs: { "officina.human.decision": "edit", "officina.node.id": "review" },
  content: { "officina.human.note": "add the title", "officina.human.edit": "Title: done" },
};

describe("evaluationsOf", () => {
  it("reads name, verdict, score, rule and explanation", () => {
    const [e] = evaluationsOf(
      span({ events: [evaluation("fail", { "gen_ai.evaluation.explanation": "missing 'title'" })] }),
    );
    expect(e).toEqual({
      timeUs: 2_000_000,
      name: "schema",
      verdict: EVALUATION_VERDICT.fail,
      label: "fail",
      score: 0,
      ruleIndex: 2,
      explanation: "missing 'title'",
    });
  });

  it("reads an unknown label as other, and a mistyped field as absent", () => {
    const [e] = evaluationsOf(
      span({ events: [{ ...evaluation("borderline"), attrs: { "gen_ai.evaluation.score.value": "high" } }] }),
    );
    expect(e.verdict).toBe(EVALUATION_VERDICT.other);
    expect(e.score).toBeNull();
    // No evaluation name: the event's own name stands in.
    expect(e.name).toBe(TRACE_EVENT.evaluation);
  });

  it("ignores events of any other name", () => {
    expect(evaluationsOf(span({ events: [feedback, { timeUs: 1, name: "x", attrs: null, content: null }] }))).toEqual(
      [],
    );
  });
});

describe("feedbackOf", () => {
  it("reads the decision, its node, and the note and edit from the content", () => {
    expect(feedbackOf(span({ events: [feedback] }))).toEqual([
      { timeUs: 3_000_000, decision: "edit", nodeId: "review", note: "add the title", edit: "Title: done" },
    ]);
  });

  it("has no note once the content is gone", () => {
    const [f] = feedbackOf(span({ events: [{ ...feedback, content: null }] }));
    expect(f.note).toBeNull();
    expect(f.decision).toBe("edit");
  });
});

describe("reviewMarks", () => {
  it("counts passes, failures and decisions", () => {
    expect(
      reviewMarks(span({ events: [evaluation("pass"), evaluation("fail"), evaluation("fail"), feedback] })),
    ).toEqual({ passed: 1, failed: 2, feedback: 1 });
    expect(reviewMarks(span())).toEqual({ passed: 0, failed: 0, feedback: 0 });
  });
});

describe("contentEntries", () => {
  it("lists retained content sorted by key, and nothing otherwise", () => {
    const content = { "gen_ai.output.messages": "b", "gen_ai.input.messages": "a" };
    expect(contentEntries(span({ content, contentState: CONTENT_STATE.retained })).map(([k]) => k)).toEqual([
      "gen_ai.input.messages",
      "gen_ai.output.messages",
    ]);
    expect(contentEntries(span({ content, contentState: CONTENT_STATE.expired }))).toEqual([]);
  });
});

describe("contentText", () => {
  it("re-indents a JSON string and leaves prose alone", () => {
    expect(contentText('[{"role":"user"}]')).toBe('[\n  {\n    "role": "user"\n  }\n]');
    expect(contentText("be brief")).toBe("be brief");
    expect(contentText("[not json")).toBe("[not json");
    expect(contentText(["a"])).toBe('[\n  "a"\n]');
  });
});
