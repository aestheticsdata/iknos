import { RUN_EVENT, SPAN_KIND } from "@lib/interfaces/spanKindTypes";
import { CONTENT_STATE, SPAN_STATUS_CODE } from "@lib/interfaces/traceSpanTypes";
import { gatesFor, gatesOf, messagesOf, runEvents } from "@lib/runInsights";
import { kindTone, spanKindOf } from "@lib/spanKind";
import { describe, expect, it } from "vitest";

import type { SpanRow } from "@lib/interfaces/traceSpanTypes";

const span = (over: Partial<SpanRow>): SpanRow => ({
  spanId: "root",
  parentSpanId: null,
  service: "fathom-front",
  name: "spec-to-code",
  kind: 1,
  startUs: 0,
  durationUs: 100,
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
  contentUntilUs: null,
  ...over,
});

/** buildTrace's shape: run › spec (llm, 2 attempts) and its gate (fail, then pass) › review. */
const RUN: SpanRow[] = [
  span({ attrs: { "officina.run.status": "completed" } }),
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
    attrs: { "officina.attempt": 1 },
  }),
  span({ spanId: "c1", parentSpanId: "a1", name: "chat m", startUs: 2, genAiModel: "m" }),
  span({
    spanId: "a2",
    parentSpanId: "spec",
    name: "spec #2",
    startUs: 40,
    genAiModel: "m",
    attrs: { "officina.attempt": 2 },
  }),
  span({
    spanId: "gate",
    parentSpanId: "root",
    name: "Testable criteria",
    startUs: 20,
    attrs: { "officina.node.id": "spec-testable", "officina.node.kind": "rule-gate" },
  }),
  span({
    spanId: "g1",
    parentSpanId: "gate",
    name: "spec-testable #1",
    startUs: 20,
    attrs: { "officina.attempt": 1, "officina.loop.target": "spec" },
  }),
  span({
    spanId: "v1",
    parentSpanId: "g1",
    name: "gate.verdict",
    startUs: 21,
    durationUs: 2,
    statusCode: SPAN_STATUS_CODE.error,
    attrs: { "officina.gate.pass": false, "officina.gate.reasons": 2 },
  }),
  span({ spanId: "g2", parentSpanId: "gate", name: "spec-testable #2", startUs: 60, attrs: { "officina.attempt": 2 } }),
  span({
    spanId: "v2",
    parentSpanId: "g2",
    name: "gate.verdict",
    startUs: 61,
    attrs: { "officina.gate.pass": true, "officina.gate.score": 0.9 },
  }),
  span({
    spanId: "rev",
    parentSpanId: "root",
    name: "Human review",
    startUs: 70,
    attrs: { "officina.node.id": "review", "officina.node.kind": "human-gate" },
  }),
  span({
    spanId: "h1",
    parentSpanId: "rev",
    name: "human.review",
    startUs: 71,
    durationUs: 9,
    attrs: { "officina.human.decision": "reject" },
  }),
];

const byId = (id: string) => RUN.find((s) => s.spanId === id) as SpanRow;

describe("spanKindOf", () => {
  it("reads each span's kind from its Officina shape", () => {
    expect(["root", "spec", "a1", "c1", "gate", "v1", "rev", "h1"].map((id) => spanKindOf(byId(id)))).toEqual([
      SPAN_KIND.run,
      SPAN_KIND.step,
      SPAN_KIND.attempt,
      SPAN_KIND.model,
      SPAN_KIND.gate,
      SPAN_KIND.verdict,
      SPAN_KIND.step,
      SPAN_KIND.human,
    ]);
  });

  it("reads OPI-36's names: the run and the sandbox by their GenAI operation, a sandbox verdict as a check", () => {
    expect(spanKindOf(span({ name: "invoke_workflow spec-to-code", genAiOperation: "invoke_workflow" }))).toBe(
      SPAN_KIND.run,
    );
    const sandbox = span({
      spanId: "sx",
      parentSpanId: "a1",
      name: "execute_tool sandbox",
      genAiOperation: "execute_tool",
    });
    expect(spanKindOf(sandbox)).toBe(SPAN_KIND.tool);
    expect(gatesOf([...RUN, { ...sandbox, attrs: { "officina.gate.pass": false } }])).toHaveLength(1);
  });

  it("inks a failed span red whatever its kind", () => {
    expect(kindTone(byId("v1"))).toBe("error");
    expect(kindTone(byId("c1"))).toBe("ok");
  });
});

describe("gates", () => {
  it("collects each gate's verdicts in order, its last one deciding", () => {
    const [gate] = gatesOf(RUN);
    expect(gate.passed).toBe(true);
    expect(gate.verdicts.map((v) => [v.attempt, v.passed, v.reasons])).toEqual([
      [1, false, 2],
      [2, true, null],
    ]);
    expect(gate.loopTarget).toBe("spec");
  });

  it("scopes to the gate a span sits in, the gates looping to its step, or all of them", () => {
    expect(gatesFor(RUN, byId("v1"))).toHaveLength(1);
    expect(gatesFor(RUN, byId("c1"))).toHaveLength(1);
    expect(gatesFor(RUN, byId("h1"))).toHaveLength(0);
    expect(gatesFor(RUN, byId("root"))).toHaveLength(1);
  });
});

describe("runEvents", () => {
  it("tells the run in order: start, failed check, retry, decision, end", () => {
    expect(runEvents(RUN).map((event) => event.kind)).toEqual([
      RUN_EVENT.start,
      RUN_EVENT.checkFailed,
      RUN_EVENT.retry,
      RUN_EVENT.decision,
      RUN_EVENT.end,
    ]);
  });
});

describe("messagesOf", () => {
  it("reads the GenAI conventions' messages, and keeps an odd shape as text", () => {
    const json = JSON.stringify([
      { role: "system", parts: [{ type: "text", content: "be brief" }] },
      { role: "user", content: "hi" },
    ]);
    expect(messagesOf(json)).toEqual([
      { position: 0, role: "system", text: "be brief" },
      { position: 1, role: "user", text: "hi" },
    ]);
    expect(messagesOf("not json")).toEqual([{ position: 0, role: "", text: "not json" }]);
    expect(messagesOf(undefined)).toEqual([]);
  });
});
