import { describe, expect, it } from "vitest";
import { GEN_AI_ATTR, MAX_ATTRIBUTES, MAX_SPANS_PER_REQUEST, MAX_STRING_CHARS, SPAN_STATUS } from "./otlp-limits";
import { decodeAttributes, OtlpMalformedError, parseTraces } from "./otlp-parse";

import type { ParseContext } from "./interfaces/otlp-types";

const NOW = new Date("2026-11-12T12:00:00.000Z");
const CTX: ParseContext = { service: "opifex-front", now: NOW, maxAgeDays: 14 };

/** 2026-11-12T11:59:00.000000123Z, in nanoseconds, as proto3 JSON writes a fixed64. */
const START = "1794484740000000123";
const END = "1794484741234567123";

const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const ROOT = "00f067aa0ba902b7";
const CHILD = "53995c3f42cd8ad8";

type SpanOver = Record<string, unknown>;

const span = (over: SpanOver = {}) => ({
  traceId: TRACE,
  spanId: ROOT,
  name: "pipeline.run",
  kind: 1,
  startTimeUnixNano: START,
  endTimeUnixNano: END,
  attributes: [],
  status: { code: SPAN_STATUS.ok },
  ...over,
});

const request = (spans: unknown[], resourceAttrs: unknown[] = []) => ({
  resourceSpans: [
    {
      resource: { attributes: resourceAttrs },
      scopeSpans: [{ scope: { name: "officina", version: "1.2.0" }, spans }],
    },
  ],
});

describe("parseTraces", () => {
  it("maps a span onto the columns, at microsecond precision", () => {
    const { spans, rejected } = parseTraces(request([span()]), CTX);

    expect(rejected).toBe(0);
    expect(spans).toHaveLength(1);
    const [s] = spans;
    expect(s.traceId).toBe(TRACE);
    expect(s.spanId).toBe(ROOT);
    expect(s.parentSpanId).toBeNull();
    expect(s.name).toBe("pipeline.run");
    expect(s.kind).toBe(1);
    expect(s.ts.toISOString()).toBe("2026-11-12T11:59:00.000Z");
    expect(s.startUs).toBe(1794484740000000n);
    // 1.234567 s, the nanoseconds below a microsecond dropped on both ends.
    expect(s.durationUs).toBe(1234567n);
    expect(s.statusCode).toBe(SPAN_STATUS.ok);
  });

  it("stamps the token's service and drops the one the payload claims", () => {
    const { spans } = parseTraces(
      request(
        [span()],
        [
          { key: "service.name", value: { stringValue: "iknos-api" } },
          { key: "service.version", value: { stringValue: "0.9.1" } },
        ],
      ),
      CTX,
    );

    expect(spans[0].service).toBe("opifex-front");
    expect(spans[0].attrs).not.toHaveProperty("resource.service.name");
    expect(JSON.stringify(spans[0].attrs)).not.toContain("iknos-api");
    expect(spans[0].attrs).toMatchObject({
      "resource.service.version": "0.9.1",
      "otel.scope.name": "officina",
      "otel.scope.version": "1.2.0",
    });
  });

  it("promotes the four GenAI attributes to columns and out of attrs", () => {
    const { spans } = parseTraces(
      request([
        span({
          attributes: [
            { key: GEN_AI_ATTR.operation, value: { stringValue: "chat" } },
            { key: GEN_AI_ATTR.requestModel, value: { stringValue: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC" } },
            { key: GEN_AI_ATTR.inputTokens, value: { intValue: "412" } },
            { key: GEN_AI_ATTR.outputTokens, value: { intValue: 96 } },
            { key: "gen_ai.response.finish_reasons", value: { arrayValue: { values: [{ stringValue: "stop" }] } } },
          ],
        }),
      ]),
      CTX,
    );

    const [s] = spans;
    expect(s.genAiOperation).toBe("chat");
    expect(s.genAiModel).toBe("Qwen2.5-0.5B-Instruct-q4f16_1-MLC");
    expect(s.inputTokens).toBe(412);
    expect(s.outputTokens).toBe(96);
    expect(s.attrs).toEqual({
      "gen_ai.response.finish_reasons": ["stop"],
      "otel.scope.name": "officina",
      "otel.scope.version": "1.2.0",
    });
  });

  it("leaves a token count that does not fit its column in attrs rather than coercing it", () => {
    const { spans } = parseTraces(
      request([span({ attributes: [{ key: GEN_AI_ATTR.inputTokens, value: { intValue: "-3" } }] })]),
      CTX,
    );

    expect(spans[0].inputTokens).toBeNull();
    expect(spans[0].attrs).toMatchObject({ [GEN_AI_ATTR.inputTokens]: -3 });
  });

  it("links a child to its parent and lower-cases ids", () => {
    const { spans } = parseTraces(
      request([span(), span({ spanId: CHILD.toUpperCase(), parentSpanId: ROOT.toUpperCase(), name: "llm.generate" })]),
      CTX,
    );

    expect(spans[1].spanId).toBe(CHILD);
    expect(spans[1].parentSpanId).toBe(ROOT);
  });

  it("reads an empty or all-zero parent as a root", () => {
    const { spans } = parseTraces(
      request([span({ parentSpanId: "" }), span({ spanId: CHILD, parentSpanId: "0000000000000000" })]),
      CTX,
    );

    expect(spans.map((s) => s.parentSpanId)).toEqual([null, null]);
  });

  it("rejects one unusable span and keeps the rest, saying why", () => {
    const outcome = parseTraces(
      request([
        span(),
        span({ spanId: "short" }),
        span({ spanId: CHILD, traceId: "0".repeat(32) }),
        span({ spanId: "1111111111111111", endTimeUnixNano: "1794484739000000000" }),
        "not a span",
      ]),
      CTX,
    );

    expect(outcome.spans).toHaveLength(1);
    expect(outcome.rejected).toBe(4);
    expect(outcome.reasons).toContain("a span cannot end before it starts");
    expect(outcome.reasons).toContain("spanId must be 16 hex characters, not all zero");
  });

  it("rejects spans outside the retention window or from the future", () => {
    const outcome = parseTraces(
      request([
        span({ startTimeUnixNano: "1000000000000000000", endTimeUnixNano: "1000000001000000000" }),
        span({ spanId: CHILD, startTimeUnixNano: "1894484740000000000", endTimeUnixNano: "1894484741000000000" }),
      ]),
      CTX,
    );

    expect(outcome.spans).toHaveLength(0);
    expect(outcome.reasons).toEqual(["span is older than the retention", "span starts in the future"]);
  });

  it("reads unset, unknown and missing status codes as unset", () => {
    const { spans } = parseTraces(
      request([
        span({ status: undefined }),
        span({ spanId: CHILD, status: { code: 7 } }),
        span({ spanId: "1111111111111111", status: { code: SPAN_STATUS.error, message: "model OOM" } }),
      ]),
      CTX,
    );

    expect(spans.map((s) => s.statusCode)).toEqual([SPAN_STATUS.unset, SPAN_STATUS.unset, SPAN_STATUS.error]);
    expect(spans[2].statusMessage).toBe("model OOM");
  });

  it("ignores fields it does not know, at every level", () => {
    const body = {
      ...request([span({ events: [{ name: "x" }], links: [], droppedAttributesCount: 0, flags: 1 })]),
      somethingNew: true,
    };
    expect(parseTraces(body, CTX).spans).toHaveLength(1);
  });

  it("answers an empty request with nothing and no error", () => {
    expect(parseTraces({}, CTX)).toEqual({ spans: [], rejected: 0, reasons: [] });
    expect(parseTraces({ resourceSpans: [] }, CTX).spans).toEqual([]);
  });

  it("refuses an envelope that is not OTLP", () => {
    expect(() => parseTraces([], CTX)).toThrow(OtlpMalformedError);
    expect(() => parseTraces("x", CTX)).toThrow(OtlpMalformedError);
    expect(() => parseTraces({ resourceSpans: {} }, CTX)).toThrow(OtlpMalformedError);
    expect(() => parseTraces({ resourceSpans: [1] }, CTX)).toThrow(OtlpMalformedError);
    expect(() => parseTraces({ resourceSpans: [{ scopeSpans: [{ spans: "no" }] }] }, CTX)).toThrow(OtlpMalformedError);
  });

  it("refuses a request over the span ceiling before decoding any of it", () => {
    const spans = Array.from({ length: MAX_SPANS_PER_REQUEST + 1 }, () => ({}));
    expect(() => parseTraces(request(spans), CTX)).toThrow(/at most 1000 spans/);
  });
});

describe("decodeAttributes", () => {
  it("decodes every scalar kind OTLP/JSON sends", () => {
    expect(
      decodeAttributes([
        { key: "s", value: { stringValue: "a" } },
        { key: "b", value: { boolValue: false } },
        { key: "i", value: { intValue: "42" } },
        { key: "n", value: { intValue: 7 } },
        { key: "d", value: { doubleValue: 0.25 } },
      ]),
    ).toEqual({ s: "a", b: false, i: 42, n: 7, d: 0.25 });
  });

  it("keeps an int64 past 2^53 as its exact digits rather than a rounded number", () => {
    expect(decodeAttributes([{ key: "big", value: { intValue: "9223372036854775807" } }])).toEqual({
      big: "9223372036854775807",
    });
  });

  it("cuts a long string to the ceiling instead of dropping it", () => {
    const out = decodeAttributes([{ key: "prompt", value: { stringValue: "x".repeat(MAX_STRING_CHARS + 10) } }]);
    expect((out.prompt as string).length).toBe(MAX_STRING_CHARS);
  });

  it("drops what it cannot store: bytes, key-value lists, non-finite numbers, malformed entries", () => {
    expect(
      decodeAttributes([
        { key: "bytes", value: { bytesValue: "AAEC" } },
        { key: "kv", value: { kvlistValue: { values: [] } } },
        { key: "nan", value: { doubleValue: "NaN" } },
        { key: "", value: { stringValue: "no key" } },
        { value: { stringValue: "no key at all" } },
        "junk",
      ]),
    ).toEqual({});
  });

  it("keeps the first attributes up to the ceiling", () => {
    const list = Array.from({ length: MAX_ATTRIBUTES + 5 }, (_, i) => ({ key: `k${i}`, value: { intValue: i } }));
    const out = decodeAttributes(list);
    expect(Object.keys(out)).toHaveLength(MAX_ATTRIBUTES);
    expect(out).toHaveProperty("k0");
    expect(out).not.toHaveProperty(`k${MAX_ATTRIBUTES}`);
  });

  it("is empty for anything that is not a list", () => {
    expect(decodeAttributes(undefined)).toEqual({});
    expect(decodeAttributes({ key: "x" })).toEqual({});
  });
});
