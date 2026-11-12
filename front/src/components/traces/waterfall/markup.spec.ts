import { AttributesTab } from "@components/traces/detail/inspector/AttributesTab";
import { ChecksTab } from "@components/traces/detail/inspector/ChecksTab";
import { ContentTab } from "@components/traces/detail/inspector/ContentTab";
import { EventsTab } from "@components/traces/detail/inspector/EventsTab";
import { SpanInspector } from "@components/traces/detail/inspector/SpanInspector";
import { SpanWaterfall } from "@components/traces/waterfall/SpanWaterfall";
import { CONTENT_STATE, SPAN_STATUS_CODE, TRACE_EVENT } from "@lib/interfaces/traceSpanTypes";
import { gatesFor, runEvents } from "@lib/runInsights";
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
  events: [],
  content: null,
  contentState: CONTENT_STATE.none,
  contentDays: null,
  contentUntilUs: null,
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
    events: [
      {
        timeUs: 2_500_000,
        name: TRACE_EVENT.evaluation,
        attrs: { "gen_ai.evaluation.name": "schema", "gen_ai.evaluation.score.label": "fail" },
        content: { "gen_ai.evaluation.explanation": "missing 'title'" },
      },
      {
        timeUs: 2_600_000,
        name: TRACE_EVENT.evaluation,
        attrs: { "gen_ai.evaluation.name": "length", "gen_ai.evaluation.score.label": "pass" },
        content: null,
      },
      {
        timeUs: 2_900_000,
        name: TRACE_EVENT.humanFeedback,
        attrs: { "officina.human.decision": "edit", "officina.node.id": "review" },
        content: { "officina.human.note": "add the title" },
      },
    ],
    content: { "gen_ai.input.messages": '[{"role":"user","content":"summarise"}]' },
    contentState: CONTENT_STATE.retained,
    contentDays: 3,
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

  it("marks a span's failed and passed gates and its human decisions, glyph and count", () => {
    const html = render(null);
    expect(html).toMatch(/data-testid="mark-failed">✕1</);
    expect(html).toMatch(/data-testid="mark-passed">✓1</);
    expect(html).toMatch(/data-testid="mark-feedback">◆1</);
    expect(html).toContain('title="1 gate evaluation failed"');
    // Only the span that carries events is marked.
    expect(html.match(/data-testid="mark-/g)).toHaveLength(3);
  });

  it("shows which span is selected", () => {
    expect(render("53995c3f42cd8ad8")).toMatch(/aria-selected="true"[^>]*data-span-id="53995c3f42cd8ad8"/);
  });
});

describe("WaterfallRow", () => {
  it("names each span's kind and labels a failure in words, not colour alone", () => {
    const html = render(null);
    expect(html).toContain('data-testid="span-kind">llm<');
    expect(html).toContain("✕ failed");
  });
});

describe("SpanInspector", () => {
  it("opens on the info tab, with a model call's model, tokens and offset", () => {
    const html = renderToStaticMarkup(
      h(SpanInspector, { span: SPANS[1], spans: SPANS, timeline: timelineOf(SPANS), tz: "UTC" }),
    );

    expect(html).toContain("test-model");
    expect(html).toContain("412 in · 96 out");
    expect(html).toContain("+1s");
    expect(html).toContain('data-tab="content"');
  });

  it("asks for a span when none is shown", () => {
    expect(
      renderToStaticMarkup(h(SpanInspector, { span: null, spans: [], timeline: timelineOf([]), tz: "UTC" })),
    ).toContain("Pick a span");
  });
});

describe("inspector tabs", () => {
  const timeline = timelineOf(SPANS);

  it("reads a sender's evaluation events as gates, with the rule's own words while kept", () => {
    const html = renderToStaticMarkup(h(ChecksTab, { gates: gatesFor(SPANS, SPANS[1]) }));

    expect(html).toContain("1 passed · 1 failed");
    expect(html).toContain("missing &#x27;title&#x27;");
  });

  it("shows retained content with its prompt", () => {
    const html = renderToStaticMarkup(h(ContentTab, { span: SPANS[1], spans: SPANS, tz: "UTC" }));
    expect(html).toContain('data-testid="span-content"');
    expect(html).toContain("summarise");
    expect(html).toContain("kept 3 days");
  });

  it("says the content expired, and after how long", () => {
    const expired = { ...SPANS[1], content: null, contentState: CONTENT_STATE.expired };
    const html = renderToStaticMarkup(h(ContentTab, { span: expired, spans: SPANS, tz: "UTC" }));
    expect(html).toContain("Content expired");
    expect(html).toContain("kept 3 days");
    expect(html).not.toContain("summarise");
  });

  it("says the content was never captured at the metadata level", () => {
    const bare = { ...SPANS[1], content: null, contentState: CONTENT_STATE.none, contentDays: null };
    const html = renderToStaticMarkup(h(ContentTab, { span: bare, spans: [SPANS[0], bare], tz: "UTC" }));
    expect(html).toContain("Content not captured");
    expect(html).toContain("metadata level");
  });

  it("lists the human decision among the run's events", () => {
    const html = renderToStaticMarkup(h(EventsTab, { events: runEvents(SPANS), timeline }));
    expect(html).toContain("Decision: edit.");
  });
});

describe("AttributesTab", () => {
  it("lists every attribute, sorted, as text", () => {
    const html = renderToStaticMarkup(h(AttributesTab, { span: SPANS[1] }));

    expect(html.indexOf("gen_ai.response.finish_reasons")).toBeLessThan(html.indexOf("officina.node"));
    expect(html).toContain("[&quot;stop&quot;]");
  });
});
