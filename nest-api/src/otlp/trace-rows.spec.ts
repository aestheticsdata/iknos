import { CONTENT_STATE } from "@contracts/traces";
import { describe, expect, it } from "vitest";
import { SPAN_LEVEL_INDEX, STATUS_MESSAGE_CONTENT_KEY } from "./otlp-limits";
import { assembleSpans, DEFAULT_TRACE_LIMIT, parseTraceId, parseTraceLimit } from "./trace-rows";

import type { Span, SpanContent, SpanEvent } from "@generated/prisma/client";

const TS = new Date("2026-11-12T11:59:00.000Z");
const SPAN_ID = "00f067aa0ba902b7";

const spanRow = (over: Partial<Span> = {}): Span =>
  ({
    id: 1n,
    ts: TS,
    service: "opifex-front",
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    spanId: SPAN_ID,
    parentSpanId: null,
    name: "pipeline.run",
    kind: 1,
    startUs: 1_794_484_740_000_123n,
    durationUs: 250n,
    statusCode: 2,
    statusMessage: null,
    genAiOperation: null,
    genAiModel: null,
    inputTokens: null,
    outputTokens: null,
    attrs: '{"officina.node":"plan"}',
    contentUntil: null,
    contentDays: null,
    ...over,
  }) as Span;

const eventRow = (over: Partial<SpanEvent> = {}): SpanEvent =>
  ({
    id: 1n,
    ts: TS,
    service: "opifex-front",
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    spanId: SPAN_ID,
    eventIndex: 0,
    timeUs: 1_794_484_740_000_200n,
    name: "gen_ai.evaluation.result",
    attrs: { "gen_ai.evaluation.score.label": "fail" },
    ...over,
  }) as SpanEvent;

const contentRow = (eventIndex: number, contentKey: string, value: unknown): SpanContent =>
  ({
    id: 1n,
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    spanId: SPAN_ID,
    spanTs: TS,
    eventIndex,
    contentKey,
    value: JSON.stringify(value),
    expiresAt: new Date("2026-11-15T12:00:00.000Z"),
  }) as SpanContent;

describe("assembleSpans", () => {
  it("turns the microsecond bigints into numbers and parses attrs", () => {
    const [row] = assembleSpans({ spans: [spanRow()], events: [], contents: [] });

    expect(row.startUs).toBe(1_794_484_740_000_123);
    expect(row.durationUs).toBe(250);
    expect(row.attrs).toEqual({ "officina.node": "plan" });
    expect(row.events).toEqual([]);
    expect(row.content).toBeNull();
    expect(row.contentState).toBe(CONTENT_STATE.none);
  });

  it("puts each event on its span in time order, with its content", () => {
    const [row] = assembleSpans({
      spans: [spanRow({ contentUntil: new Date("2026-11-15T12:00:00Z"), contentDays: 3 })],
      events: [
        eventRow({ eventIndex: 1, timeUs: 1_794_484_740_000_900n, name: "officina.human.feedback", attrs: null }),
        eventRow(),
        eventRow({ spanId: "1111111111111111" }),
      ],
      contents: [
        contentRow(0, "gen_ai.evaluation.explanation", "missing field"),
        contentRow(1, "officina.human.note", "tighten it"),
        contentRow(SPAN_LEVEL_INDEX, "gen_ai.input.messages", [{ role: "user" }]),
        contentRow(SPAN_LEVEL_INDEX, STATUS_MESSAGE_CONTENT_KEY, "model OOM"),
      ],
    });

    expect(row.events.map((e) => e.name)).toEqual(["gen_ai.evaluation.result", "officina.human.feedback"]);
    expect(row.events[0]).toEqual({
      timeUs: 1_794_484_740_000_200,
      name: "gen_ai.evaluation.result",
      attrs: { "gen_ai.evaluation.score.label": "fail" },
      content: { "gen_ai.evaluation.explanation": "missing field" },
    });
    expect(row.events[1].content).toEqual({ "officina.human.note": "tighten it" });
    // The span's own content, merged back under its keys; the status message back in its field.
    expect(row.content).toEqual({ "gen_ai.input.messages": [{ role: "user" }] });
    expect(row.statusMessage).toBe("model OOM");
    expect(row.contentState).toBe(CONTENT_STATE.retained);
    expect(row.contentDays).toBe(3);
  });

  it("says expired when content was kept and none is left", () => {
    const [row] = assembleSpans({
      spans: [spanRow({ contentUntil: new Date("2026-11-01T00:00:00Z"), contentDays: 3 })],
      events: [eventRow()],
      contents: [],
    });

    expect(row.contentState).toBe(CONTENT_STATE.expired);
    expect(row.content).toBeNull();
    expect(row.statusMessage).toBeNull();
    expect(row.events[0].content).toBeNull();
  });

  it("keeps a pre-v2 span's status message from its column", () => {
    const [row] = assembleSpans({ spans: [spanRow({ statusMessage: "boom" })], events: [], contents: [] });
    expect(row.statusMessage).toBe("boom");
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
