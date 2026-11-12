import { CHECKS, REVIEW } from "@contracts/ai-runs";
import { describe, expect, it } from "vitest";
import { parseOffset, parseOptionalService, parseRequiredService, parseRunFilters } from "./run-query";
import { factFromRaw, factFromRow } from "./span-facts";

import type { SpanRow } from "@contracts/traces";

describe("run list query", () => {
  it("parses the filters, and treats empty as any", () => {
    expect(parseRunFilters({ checks: CHECKS.failed, review: "", prompt: " spec@v14 ", model: undefined })).toEqual({
      checks: CHECKS.failed,
      review: null,
      prompt: "spec@v14",
      model: null,
    });
    expect(parseRunFilters({ review: REVIEW.reject }).review).toBe(REVIEW.reject);
  });

  it("refuses a value outside the vocabulary", () => {
    expect(() => parseRunFilters({ checks: "maybe" })).toThrow();
    expect(() => parseRunFilters({ model: "x".repeat(256) })).toThrow();
  });

  it("reads `all` and an empty service as every service, and requires one where it must", () => {
    expect(parseOptionalService("all")).toBeNull();
    expect(parseOptionalService("")).toBeNull();
    expect(parseOptionalService("fathom-front")).toBe("fathom-front");
    expect(() => parseRequiredService("all")).toThrow();
  });

  it("bounds the offset", () => {
    expect(parseOffset(undefined)).toBe(0);
    expect(parseOffset("50")).toBe(50);
    expect(() => parseOffset("-1")).toThrow();
  });
});

describe("span facts", () => {
  it("reads the unquoted JSON text of the facts query, leniently", () => {
    const fact = factFromRaw({
      traceId: "t",
      service: "s",
      spanId: "a",
      parentSpanId: null,
      name: "gate.verdict",
      startUs: 5n,
      durationUs: "7",
      statusCode: 2,
      model: null,
      inputTokens: null,
      outputTokens: null,
      agentName: "spec-to-code",
      nodeId: null,
      nodeKind: null,
      attempt: null,
      promptVersion: "null",
      pipelineVersion: "8",
      gatePass: "false",
      decision: null,
      runStatus: null,
      firstTokenMs: "abc",
      tokensPerSecond: null,
      loopTarget: "spec",
      hasContent: 1n,
      contentUntilUs: new Date("2026-11-19T12:00:00Z"),
    });

    expect(fact).toMatchObject({
      startUs: 5,
      durationUs: 7,
      pipelineVersion: 8,
      promptVersion: null,
      gatePass: false,
      hasContent: true,
      agentName: "spec-to-code",
      contentUntilUs: Date.parse("2026-11-19T12:00:00Z") * 1000,
    });
    expect(fact.firstTokenMs).toBeNull();
  });

  it("reads the same facts from a detail row's parsed attributes — OPI-36's keys first, the old ones after", () => {
    const row: SpanRow = {
      spanId: "a",
      parentSpanId: null,
      service: "s",
      name: "chat m",
      kind: 1,
      startUs: 1,
      durationUs: 2,
      statusCode: 1,
      statusMessage: null,
      genAiOperation: null,
      genAiModel: "m",
      inputTokens: 3,
      outputTokens: 4,
      attrs: { "gen_ai.prompt.version": 14, "gen_ai.response.time_to_first_chunk": 1.25, "officina.gate.pass": true },
      events: [],
      content: null,
      contentState: "expired",
      contentDays: 7,
      contentUntilUs: 42,
    };

    expect(factFromRow("t", row)).toMatchObject({
      model: "m",
      promptVersion: 14,
      firstTokenMs: 1250,
      gatePass: true,
      hasContent: true,
      contentUntilUs: 42,
    });
  });
});
