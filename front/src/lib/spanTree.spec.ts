import { CONTENT_STATE } from "@lib/interfaces/traceSpanTypes";
import { describe, expect, it } from "vitest";
import { buildSpanTree, flattenTree, waterfallLines } from "./spanTree";

import type { SpanRow } from "@lib/interfaces/traceSpanTypes";

const span = (spanId: string, parentSpanId: string | null, startUs: number): SpanRow => ({
  spanId,
  parentSpanId,
  service: "opifex-front",
  name: spanId,
  kind: 0,
  startUs,
  durationUs: 10,
  statusCode: 0,
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
});

const shape = (spans: SpanRow[]) =>
  waterfallLines(spans).map((line) => `${"  ".repeat(line.depth)}${line.span.spanId}`);

describe("buildSpanTree", () => {
  it("nests children under their parent, siblings in start order", () => {
    const spans = [span("c2", "root", 30), span("root", null, 0), span("c1", "root", 10), span("g1", "c1", 12)];
    expect(shape(spans)).toEqual(["root", "  c1", "    g1", "  c2"]);
  });

  it("breaks a start-time tie by span id, so a trace always draws the same way", () => {
    expect(shape([span("b", null, 5), span("a", null, 5)])).toEqual(["a", "b"]);
  });

  it("promotes a span whose parent is missing to a root, and marks it", () => {
    const lines = waterfallLines([span("root", null, 0), span("lost", "gone", 5)]);
    expect(lines.map((l) => [l.span.spanId, l.depth, l.orphan])).toEqual([
      ["root", 0, false],
      ["lost", 0, true],
    ]);
  });

  it("never loses a span to a cycle or a self-parent", () => {
    const lines = waterfallLines([span("a", "b", 0), span("b", "a", 1), span("self", "self", 2)]);
    expect(lines.map((l) => l.span.spanId).sort()).toEqual(["a", "b", "self"]);
  });

  it("keeps the first of two spans with the same id", () => {
    const roots = buildSpanTree([span("x", null, 0), { ...span("x", null, 9), name: "dup" }]);
    expect(roots).toHaveLength(1);
    expect(roots[0].span.name).toBe("x");
  });

  it("flattens a deep chain without recursion", () => {
    const chain = Array.from({ length: 5000 }, (_, i) => span(`s${i}`, i === 0 ? null : `s${i - 1}`, i));
    const lines = flattenTree(buildSpanTree(chain.slice(0, 1)));
    expect(lines).toHaveLength(1);
    expect(waterfallLines(chain).at(-1)?.depth).toBe(4999);
  });

  it("is empty for no spans", () => {
    expect(waterfallLines([])).toEqual([]);
  });
});
