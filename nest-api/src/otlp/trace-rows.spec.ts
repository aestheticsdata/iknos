import { TRACE_STATUS } from "@contracts/traces";
import { describe, expect, it } from "vitest";
import {
  CONCAT_SEPARATOR,
  DEFAULT_TRACE_LIMIT,
  parseTraceId,
  parseTraceLimit,
  toSpanRow,
  toSummary,
} from "./trace-rows";

import type { Span } from "@generated/prisma/client";
import type { RawTraceRow } from "./interfaces/otlp-types";

const raw = (over: Partial<RawTraceRow> = {}): RawTraceRow => ({
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  service: "opifex-front",
  rootName: `pipeline.run${CONCAT_SEPARATOR}llm.generate`,
  startUs: 1_794_484_740_000_000n,
  endUs: 1_794_484_744_500_000n,
  spanCount: 7n,
  anyError: 0n,
  anyOk: 1n,
  inputTokens: "412",
  outputTokens: null,
  models: `a-model${CONCAT_SEPARATOR}b-model`,
  ...over,
});

describe("toSummary", () => {
  it("reads whatever numeric shape the driver returns", () => {
    const s = toSummary(raw());

    expect(s.rootName).toBe("pipeline.run");
    expect(s.startUs).toBe(1_794_484_740_000_000);
    expect(s.durationUs).toBe(4_500_000);
    expect(s.spanCount).toBe(7);
    expect(s.inputTokens).toBe(412);
    expect(s.outputTokens).toBeNull();
    expect(s.models).toEqual(["a-model", "b-model"]);
  });

  it("lets one failed span mark the whole trace as failed", () => {
    expect(toSummary(raw({ anyError: 1n })).status).toBe(TRACE_STATUS.error);
    expect(toSummary(raw()).status).toBe(TRACE_STATUS.ok);
    expect(toSummary(raw({ anyOk: 0 })).status).toBe(TRACE_STATUS.unset);
  });

  it("has no models and no name rather than inventing them", () => {
    const s = toSummary(raw({ models: null, rootName: null }));
    expect(s.models).toEqual([]);
    expect(s.rootName).toBe("");
  });
});

describe("toSpanRow", () => {
  it("turns the microsecond bigints into numbers and parses attrs", () => {
    const row = toSpanRow({
      id: 1n,
      ts: new Date(),
      service: "opifex-front",
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      parentSpanId: null,
      name: "pipeline.run",
      kind: 1,
      startUs: 1_794_484_740_000_123n,
      durationUs: 250n,
      statusCode: 2,
      statusMessage: "boom",
      genAiOperation: null,
      genAiModel: null,
      inputTokens: null,
      outputTokens: null,
      attrs: '{"officina.node":"plan"}',
    } as Span);

    expect(row.startUs).toBe(1_794_484_740_000_123);
    expect(row.durationUs).toBe(250);
    expect(row.attrs).toEqual({ "officina.node": "plan" });
  });
});

describe("query parameters", () => {
  it("defaults and bounds the limit", () => {
    expect(parseTraceLimit(undefined)).toBe(DEFAULT_TRACE_LIMIT);
    expect(parseTraceLimit("20")).toBe(20);
    expect(() => parseTraceLimit("0")).toThrow();
    expect(() => parseTraceLimit("501")).toThrow();
    expect(() => parseTraceLimit("1.5")).toThrow();
  });

  it("accepts a trace id in either case and nothing else", () => {
    expect(parseTraceId("4BF92F3577B34DA6A3CE929D0E0E4736")).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(() => parseTraceId("b7e41c02a9d3")).toThrow();
  });
});
