import { describe, expect, it } from "vitest";
import { barHeight, barSpan, foldSum, MIN_BAR_PX, meanOf, peakOf, slotAt, slotCenter } from "./barGeometry";
import { formatChartValue, peakAvgLabel } from "./chartFormat";
import { areaPath, curvePath } from "./curvePath";
import { drawDomain, extentOf, runsOf, yOn } from "./gaugeScale";
import { dayStarts, relativeTicks } from "./timeAxis";
import { movingAverage, SHORT_RANGE_WINDOW, trendWindow } from "./trend";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("barSpan", () => {
  it("lays bars on whole pixels with a 1px gap", () => {
    const spans = Array.from({ length: 168 }, (_, i) => barSpan(i, 168, 900));
    for (const span of spans) {
      expect(Number.isInteger(span.x)).toBe(true);
      expect(Number.isInteger(span.width)).toBe(true);
    }
    // Every gap is exactly one pixel.
    for (let i = 1; i < spans.length; i++) expect(spans[i].x - (spans[i - 1].x + spans[i - 1].width)).toBe(1);
    expect(spans.at(-1)?.x).toBeLessThan(900);
  });

  it("drops the gap when a slot is narrower than two pixels", () => {
    const span = barSpan(0, 100, 150);
    expect(span.width).toBeGreaterThanOrEqual(1);
  });

  it("keeps one bucket as one bar across the plot", () => {
    expect(barSpan(0, 1, 300)).toEqual({ x: 0, width: 299 });
  });
});

describe("slotAt and slotCenter", () => {
  it("are inverse at each slot's middle and clamp at the edges", () => {
    for (let i = 0; i < 60; i++) expect(slotAt(slotCenter(i, 60, 480), 60, 480)).toBe(i);
    expect(slotAt(-5, 60, 480)).toBe(0);
    expect(slotAt(9999, 60, 480)).toBe(59);
    expect(slotAt(10, 0, 480)).toBe(0);
  });
});

describe("barHeight", () => {
  it("draws nothing for zero or unknown, and never less than the floor for anything else", () => {
    expect(barHeight(0, 10, 56)).toBe(0);
    expect(barHeight(null, 10, 56)).toBe(0);
    expect(barHeight(0.01, 1000, 56)).toBe(MIN_BAR_PX);
    expect(barHeight(10, 10, 56)).toBe(56);
  });

  it("keeps a peak a hundred times the mean inside the plot", () => {
    expect(barHeight(1000, 1000, 56)).toBe(56);
    expect(barHeight(10, 1000, 56)).toBe(MIN_BAR_PX);
  });

  it("draws nothing on an all-zero series rather than dividing by zero", () => {
    expect(barHeight(0, 0, 56)).toBe(0);
    expect(peakOf([0, 0, 0])).toBe(0);
  });
});

describe("meanOf", () => {
  it("averages known values up to an index and ignores holes", () => {
    expect(meanOf([2, null, 4, 100], 2)).toBe(3);
    expect(meanOf([null, null])).toBeNull();
  });
});

describe("foldSum", () => {
  it("sums sixty minutes into twenty bars of three, and keeps a short tail", () => {
    const folded = foldSum(
      Array.from({ length: 60 }, () => 1),
      3,
    );
    expect(folded).toHaveLength(20);
    expect(folded.every((n) => n === 3)).toBe(true);
    expect(foldSum([1, 2, 3, 4], 3)).toEqual([6, 4]);
  });
});

describe("formatChartValue", () => {
  it("writes one decimal under ten and groups thousands with a narrow no-break space", () => {
    expect(formatChartValue(6.54)).toBe("6.5");
    expect(formatChartValue(18_747)).toBe("18 747");
    expect(formatChartValue(3)).toBe("3");
    expect(formatChartValue(117.4)).toBe("117");
    expect(formatChartValue(null)).toBe("—");
  });

  it("names a peak and an average, or nothing for a silent series", () => {
    expect(peakAvgLabel(6.5, 1.6)).toBe("peak 6.5 · avg 1.6");
    expect(peakAvgLabel(0, 0)).toBeNull();
  });
});

describe("curvePath", () => {
  /** Every y a cubic segment of `d` reaches, sampled — what the stroke actually passes through. */
  const sampledYs = (d: string): number[] => {
    const numbers = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    const ys: number[] = [];
    let y0 = numbers[1];
    for (let i = 2; i + 5 < numbers.length + 1; i += 6) {
      const [, c1, , c2, , y1] = numbers.slice(i, i + 6);
      for (let t = 0; t <= 1; t += 0.05) {
        const u = 1 - t;
        ys.push(u * u * u * y0 + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * y1);
      }
      y0 = y1;
    }
    return ys;
  };

  it("never goes below the baseline when a series drops to zero and climbs back", () => {
    // y grows downward: the baseline is y = 50.
    const points = [0, 40, 0, 0, 45, 2, 0].map((v, i) => ({ x: i * 10, y: 50 - v }));
    for (const y of sampledYs(curvePath(points))) expect(y).toBeLessThanOrEqual(50 + 1e-9);
  });

  it("degrades to a move or a line for one or two points", () => {
    expect(curvePath([])).toBe("");
    expect(curvePath([{ x: 1, y: 2 }])).toBe("M1,2");
    expect(
      curvePath([
        { x: 0, y: 0 },
        { x: 10, y: 5 },
      ]),
    ).toBe("M0,0L10,5");
  });

  it("closes the area down to the baseline", () => {
    const d = areaPath(
      [
        { x: 0, y: 10 },
        { x: 10, y: 5 },
        { x: 20, y: 8 },
      ],
      30,
    );
    expect(d.endsWith("L20,30L0,30Z")).toBe(true);
  });
});

describe("trend", () => {
  it("spans a day of buckets, or ten on an hour", () => {
    expect(trendWindow(HOUR, 7 * DAY)).toBe(24);
    expect(trendWindow(2 * HOUR, 14 * DAY)).toBe(12);
    expect(trendWindow(60_000, HOUR)).toBe(SHORT_RANGE_WINDOW);
  });

  it("is a trailing mean over past buckets only", () => {
    expect(movingAverage([2, 4, 6, 8], 2)).toEqual([2, 3, 5, 7]);
    expect(movingAverage([2, 4, 6, 8], 2, 1)).toEqual([2, 3, null, null]);
    expect(movingAverage([null, 4, null], 3)).toEqual([null, 4, 4]);
  });
});

describe("gaugeScale", () => {
  it("frames the series between its own extremes, never dipping below zero for a positive series", () => {
    const extent = extentOf([30, null, 40, 35]);
    expect(extent).toEqual({ min: 30, max: 40 });
    const domain = drawDomain({ min: 0.2, max: 40 });
    expect(domain.min).toBe(0);
    expect(yOn(domain.max, domain, 30)).toBe(0);
  });

  it("breaks the curve at a hole instead of walking across it", () => {
    const runs = runsOf([9, 10, null, 8, 9, null, 7], (value, index) => ({ x: index, y: value }));
    expect(runs.map((run) => run.map((point) => point.x))).toEqual([[0, 1], [3, 4], [6]]);
  });

  it("lays a flat series across the middle, and finds nothing in an empty one", () => {
    const domain = drawDomain({ min: 412, max: 412 });
    expect(yOn(412, domain, 30)).toBeCloseTo(15);
    expect(extentOf([null, null])).toBeNull();
  });
});

describe("timeAxis", () => {
  it("marks where each day starts on the reader's clock", () => {
    // Hourly buckets from Fri 6 Nov 2026, 15:00 Paris, for two days.
    const from = Date.parse("2026-11-06T14:00:00Z");
    const starts = Array.from({ length: 48 }, (_, i) => from + i * HOUR);
    const days = dayStarts(starts, HOUR, "Europe/Paris");
    expect(days).toEqual([
      { index: 9, label: "Sat 7" },
      { index: 33, label: "Sun 8" },
    ]);
  });

  it("counts the first bucket only when it opens its day", () => {
    const midnight = Date.parse("2026-11-05T23:00:00Z");
    expect(dayStarts([midnight, midnight + HOUR], HOUR, "Europe/Paris")[0]).toEqual({ index: 0, label: "Fri 6" });
  });

  it("names a gauge's range relative to now", () => {
    expect(relativeTicks(HOUR)).toEqual(["−60m", "−30m", "now"]);
    expect(relativeTicks(DAY)).toEqual(["−24h", "−12h", "now"]);
    expect(relativeTicks(7 * DAY)).toEqual(["−7d", "−3.5d", "now"]);
  });
});
