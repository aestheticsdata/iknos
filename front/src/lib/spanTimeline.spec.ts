import { describe, expect, it } from "vitest";
import { axisTicks, barBox, formatMicros, MIN_BAR_PCT, spanTone, timelineOf, totalTokens } from "./spanTimeline";

import type { SpanRow } from "@lib/interfaces/traceSpanTypes";

const span = (startUs: number, durationUs: number, statusCode = 0): SpanRow => ({
  spanId: `${startUs}`,
  parentSpanId: null,
  service: "s",
  name: "n",
  kind: 0,
  startUs,
  durationUs,
  statusCode,
  statusMessage: null,
  genAiOperation: null,
  genAiModel: null,
  inputTokens: null,
  outputTokens: null,
  attrs: null,
});

describe("timelineOf", () => {
  it("runs from the first start to the last end, whichever span holds it", () => {
    expect(timelineOf([span(100, 50), span(120, 200), span(90, 5)])).toEqual({ startUs: 90, durationUs: 230 });
  });

  it("is empty for no spans", () => {
    expect(timelineOf([])).toEqual({ startUs: 0, durationUs: 0 });
  });
});

describe("barBox", () => {
  const timeline = { startUs: 1000, durationUs: 1000 };

  it("places a bar in percent of the trace", () => {
    expect(barBox(span(1250, 500), timeline)).toEqual({ leftPct: 25, widthPct: 50 });
  });

  it("keeps a tiny span visible", () => {
    expect(barBox(span(1500, 1), timeline).widthPct).toBe(MIN_BAR_PCT);
  });

  it("never pushes a bar past the right edge", () => {
    const box = barBox(span(2000, 0), timeline);
    expect(box.leftPct + box.widthPct).toBeLessThanOrEqual(100);
    expect(box.widthPct).toBe(MIN_BAR_PCT);
  });

  it("fills the drawing for a trace with no length", () => {
    expect(barBox(span(5, 0), { startUs: 5, durationUs: 0 })).toEqual({ leftPct: 0, widthPct: 100 });
  });
});

describe("axisTicks", () => {
  it("labels both ends and the even steps between", () => {
    expect(axisTicks({ startUs: 0, durationUs: 1000 }, 4)).toEqual([
      { pct: 0, offsetUs: 0 },
      { pct: 25, offsetUs: 250 },
      { pct: 50, offsetUs: 500 },
      { pct: 75, offsetUs: 750 },
      { pct: 100, offsetUs: 1000 },
    ]);
  });
});

describe("formatMicros", () => {
  it("says microseconds below a millisecond and defers to the app's durations above", () => {
    expect(formatMicros(350)).toBe("350µs");
    expect(formatMicros(4200)).toBe("4.2ms");
    expect(formatMicros(1_300_000)).toBe("1.3s");
  });
});

describe("spanTone", () => {
  it("colours errors, accents ok, leaves unset neutral", () => {
    expect(spanTone(span(0, 1, 2))).toBe("error");
    expect(spanTone(span(0, 1, 1))).toBe("ok");
    expect(spanTone(span(0, 1, 0))).toBe("neutral");
  });
});

describe("totalTokens", () => {
  it("adds what was reported and says nothing when nothing was", () => {
    expect(totalTokens(412, 96)).toBe(508);
    expect(totalTokens(null, 12)).toBe(12);
    expect(totalTokens(null, null)).toBeNull();
  });
});
