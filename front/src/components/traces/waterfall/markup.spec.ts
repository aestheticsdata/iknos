import { SpanInspector } from "@components/traces/SpanInspector";
import { SpanWaterfall } from "@components/traces/waterfall/SpanWaterfall";
import { SPAN_STATUS_CODE } from "@lib/interfaces/traceSpanTypes";
import { timelineOf } from "@lib/spanTimeline";
import { waterfallLines } from "@lib/spanTree";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { SpanRow } from "@lib/interfaces/traceSpanTypes";

/**
 * The span waterfall's markup, rendered to a string (IKN-87) — the `markup.spec.ts` approach of
 * the service view: what is rendered, never how it looks.
 */

const span = (over: Partial<SpanRow>): SpanRow => ({
  spanId: "00f067aa0ba902b7",
  parentSpanId: null,
  service: "opifex-front",
  name: "pipeline.run",
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
  ...over,
});

const SPANS = [
  span({}),
  span({
    spanId: "53995c3f42cd8ad8",
    parentSpanId: "00f067aa0ba902b7",
    name: "llm.generate",
    startUs: 2_000_000,
    durationUs: 1_000_000,
    statusCode: SPAN_STATUS_CODE.error,
    genAiModel: "test-model",
    inputTokens: 412,
    outputTokens: 96,
    attrs: { "officina.node": "plan", "gen_ai.response.finish_reasons": ["stop"] },
  }),
  span({
    spanId: "1111111111111111",
    parentSpanId: "ffffffffffffffff",
    name: "late.child",
    startUs: 4_500_000,
    durationUs: 500_000,
  }),
];

const render = (selected: string | null) =>
  renderToStaticMarkup(
    h(SpanWaterfall, {
      lines: waterfallLines(SPANS),
      timeline: timelineOf(SPANS),
      selected,
      onPick: () => undefined,
      onHover: () => undefined,
    }),
  );

describe("SpanWaterfall", () => {
  it("draws every span, parents first, nested by aria level", () => {
    const html = render(null);
    const order = [...html.matchAll(/data-span-id="([0-9a-f]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["00f067aa0ba902b7", "53995c3f42cd8ad8", "1111111111111111"]);
    expect(html).toContain('aria-level="2"');
  });

  it("places the child's bar on the run's own clock", () => {
    // The run spans 1.0 s → 5.0 s; the child starts at 2.0 s for 1.0 s: 25 % in, 25 % wide.
    expect(render(null)).toContain("left:25%;width:25%");
  });

  it("marks a span whose parent never arrived", () => {
    expect(render(null)).toContain("Its parent span never arrived");
  });

  it("prints durations as text and labels the axis", () => {
    const html = render(null);
    expect(html).toContain(">1s<");
    expect(html).toContain(">500ms<");
    expect(html).toMatch(/left:100%">4s</);
  });

  it("shows which span is selected", () => {
    expect(render("53995c3f42cd8ad8")).toMatch(/aria-selected="true"[^>]*data-span-id="53995c3f42cd8ad8"/);
  });
});

describe("SpanInspector", () => {
  it("lists the promoted GenAI fields and every attribute, sorted", () => {
    const html = renderToStaticMarkup(h(SpanInspector, { span: SPANS[1], timeline: timelineOf(SPANS) }));

    expect(html).toContain("test-model");
    expect(html).toContain("412");
    expect(html).toContain("+1s");
    expect(html.indexOf("gen_ai.response.finish_reasons")).toBeLessThan(html.indexOf("officina.node"));
    expect(html).toContain("[&quot;stop&quot;]");
  });

  it("asks for a span when none is shown", () => {
    expect(renderToStaticMarkup(h(SpanInspector, { span: null, timeline: timelineOf([]) }))).toContain("Pick a span");
  });
});
