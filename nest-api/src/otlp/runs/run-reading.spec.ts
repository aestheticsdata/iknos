import { CHECKS, REVIEW, RUN_STATE, TELEMETRY } from "@contracts/ai-runs";
import { describe, expect, it } from "vitest";
import { readRun, readRuns } from "./run-reading";

import type { EventFact, SpanFact } from "../interfaces/ai-run-types";

const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";

const fact = (over: Partial<SpanFact>): SpanFact => ({
  traceId: TRACE,
  service: "fathom-front",
  spanId: "0000000000000000",
  parentSpanId: null,
  name: "span",
  startUs: 0,
  durationUs: 1,
  statusCode: 1,
  model: null,
  inputTokens: null,
  outputTokens: null,
  agentName: null,
  nodeId: null,
  nodeKind: null,
  attempt: null,
  promptVersion: null,
  pipelineVersion: null,
  gatePass: null,
  decision: null,
  runStatus: null,
  firstTokenMs: null,
  tokensPerSecond: null,
  loopTarget: null,
  hasContent: false,
  contentUntilUs: null,
  ...over,
});

/** run › spec (llm, two attempts) › gate testable (fail then pass) › review (edit) — buildTrace's shape. */
function officinaRun(over: Partial<SpanFact> = {}): SpanFact[] {
  return [
    fact({
      spanId: "root",
      name: "spec-to-code",
      durationUs: 100,
      pipelineVersion: 8,
      runStatus: "completed",
      ...over,
    }),
    fact({
      spanId: "spec",
      parentSpanId: "root",
      name: "Spec",
      startUs: 1,
      durationUs: 60,
      nodeId: "spec",
      nodeKind: "llm",
    }),
    fact({
      spanId: "a1",
      parentSpanId: "spec",
      name: "spec #1",
      startUs: 1,
      durationUs: 20,
      attempt: 1,
      promptVersion: 14,
      model: "m",
      inputTokens: 100,
      outputTokens: 50,
    }),
    fact({
      spanId: "c1",
      parentSpanId: "a1",
      name: "chat m",
      startUs: 2,
      durationUs: 18,
      model: "m",
      inputTokens: 100,
      outputTokens: 50,
      firstTokenMs: 900,
      tokensPerSecond: 200,
      hasContent: true,
      contentUntilUs: 5000,
    }),
    fact({
      spanId: "a2",
      parentSpanId: "spec",
      name: "spec #2",
      startUs: 40,
      durationUs: 20,
      attempt: 2,
      promptVersion: 14,
      model: "m",
      inputTokens: 120,
      outputTokens: 60,
    }),
    fact({
      spanId: "c2",
      parentSpanId: "a2",
      name: "chat m",
      startUs: 41,
      durationUs: 18,
      model: "m",
      inputTokens: 120,
      outputTokens: 60,
    }),
    fact({
      spanId: "gate",
      parentSpanId: "root",
      name: "Testable criteria",
      startUs: 22,
      durationUs: 40,
      nodeId: "spec-testable",
      nodeKind: "rule-gate",
    }),
    fact({
      spanId: "g1",
      parentSpanId: "gate",
      name: "spec-testable #1",
      startUs: 22,
      attempt: 1,
      gatePass: false,
      loopTarget: "spec",
    }),
    fact({ spanId: "v1", parentSpanId: "g1", name: "gate.verdict", startUs: 23, gatePass: false, statusCode: 2 }),
    fact({ spanId: "g2", parentSpanId: "gate", name: "spec-testable #2", startUs: 61, attempt: 2, gatePass: true }),
    fact({ spanId: "v2", parentSpanId: "g2", name: "gate.verdict", startUs: 62, gatePass: true }),
    fact({
      spanId: "rev",
      parentSpanId: "root",
      name: "Human review",
      startUs: 70,
      durationUs: 30,
      nodeId: "review",
      nodeKind: "human-gate",
    }),
    fact({ spanId: "r1", parentSpanId: "rev", name: "review #1", startUs: 70, attempt: 1 }),
    fact({ spanId: "h1", parentSpanId: "r1", name: "human.review", startUs: 71, decision: "edit" }),
  ];
}

describe("readRun", () => {
  it("reads an Officina run: steps, the gate's last verdict, the review, the telemetry", () => {
    const { summary, gates, steps } = readRun(officinaRun());

    expect(summary).toMatchObject({
      pipeline: "spec-to-code",
      pipelineVersion: 8,
      durationUs: 100,
      steps: 2,
      state: RUN_STATE.completed,
      checks: CHECKS.passed,
      failedGates: 0,
      review: REVIEW.edit,
      telemetry: TELEMETRY.full,
      contentUntilUs: 5000,
      prompts: ["spec@v14"],
      model: "m",
    });
    expect(gates).toEqual([
      { nodeId: "spec-testable", label: "Testable criteria", passed: true, failures: 1, loopTarget: "spec" },
    ]);
    expect(steps.map((step) => step.nodeId)).toEqual(["spec", "review"]);
  });

  it("counts a call's tokens once, from the leaf, not again from the attempt that copies them", () => {
    const { summary, steps } = readRun(officinaRun());

    expect(summary.inputTokens).toBe(220);
    expect(summary.outputTokens).toBe(110);
    expect(steps[0].tokens).toBe(330);
    expect(steps[0].firstTokenMs).toEqual([900]);
  });

  it("fails the checks when a gate's last verdict failed", () => {
    const spans = officinaRun().map((span) => (span.spanId === "v2" ? { ...span, gatePass: false } : span));

    expect(readRun(spans).summary).toMatchObject({ checks: CHECKS.failed, failedGates: 1 });
  });

  it("leaves the checks pending while the run is going", () => {
    expect(readRun(officinaRun({ runStatus: "running" })).summary).toMatchObject({
      state: RUN_STATE.running,
      checks: CHECKS.pending,
    });
  });

  it("does not count the human gate as an automated check, even if it emits a verdict", () => {
    const spans = [
      ...officinaRun(),
      fact({ spanId: "hv", parentSpanId: "r1", name: "gate.verdict", startUs: 72, gatePass: false }),
    ];

    expect(readRun(spans).summary.checks).toBe(CHECKS.passed);
  });

  it("says none when nobody reviewed, and metadata when nothing was captured", () => {
    const spans = officinaRun()
      .filter((span) => span.spanId !== "h1")
      .map((span) => ({ ...span, hasContent: false }));

    expect(readRun(spans).summary).toMatchObject({ review: REVIEW.none, telemetry: TELEMETRY.metadata });
  });

  it("takes a sandbox run as a verdict too: the attribute decides, not the name", () => {
    const spans = [
      ...officinaRun(),
      fact({
        spanId: "tests",
        parentSpanId: "root",
        name: "Tests pass",
        startUs: 65,
        nodeId: "code-tests",
        nodeKind: "code-exec",
      }),
      fact({ spanId: "t1", parentSpanId: "tests", name: "code-tests #1", startUs: 65, attempt: 1, gatePass: false }),
      fact({ spanId: "sx", parentSpanId: "t1", name: "execute_tool sandbox", startUs: 66, gatePass: false }),
    ];

    expect(readRun(spans).summary).toMatchObject({ checks: CHECKS.failed, failedGates: 1 });
  });

  it("ignores a decision outside Officina's vocabulary", () => {
    const spans = officinaRun().map((span) => (span.spanId === "h1" ? { ...span, decision: "maybe" } : span));

    expect(readRun(spans).summary.review).toBe(REVIEW.none);
  });
});

describe("readRun from events alone", () => {
  const event = (over: Partial<EventFact>): EventFact => ({
    traceId: TRACE,
    spanId: "llm",
    timeUs: 10,
    name: "gen_ai.evaluation.result",
    evaluation: "schema",
    label: "fail",
    ruleIndex: null,
    decision: null,
    ...over,
  });
  const spans = [
    fact({ spanId: "root", name: "pipeline.run" }),
    fact({ spanId: "llm", parentSpanId: "root", name: "llm.generate", startUs: 1, model: "m" }),
  ];

  it("reads a sender's gates and decision from its evaluation and feedback events", () => {
    const events = [
      event({}),
      event({ ruleIndex: 0 }),
      event({ name: "officina.human.feedback", evaluation: null, label: null, decision: "edit", timeUs: 20 }),
    ];

    expect(readRun(spans, events).summary).toMatchObject({
      checks: CHECKS.failed,
      failedGates: 1,
      review: REVIEW.edit,
    });
  });

  it("lets a later passing verdict of the same gate decide", () => {
    expect(readRun(spans, [event({}), event({ label: "pass", timeUs: 30 })]).summary.checks).toBe(CHECKS.passed);
  });
});

describe("readRuns", () => {
  it("splits facts by trace and returns the newest run first", () => {
    const older = officinaRun();
    const newer = officinaRun().map((span) => ({ ...span, traceId: "b".repeat(32), startUs: span.startUs + 1000 }));

    expect(readRuns([...older, ...newer]).map((reading) => reading.summary.traceId)).toEqual(["b".repeat(32), TRACE]);
  });
});
