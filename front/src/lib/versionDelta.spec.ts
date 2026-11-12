import { deltaPts, formatPct, shortModel, signed } from "@lib/aiRunFormat";
import { BETTER, VERSION_ROW } from "@lib/interfaces/aiRunTypes";
import { rateChart } from "@lib/qualityChart";
import { compareMeasure, compareRate } from "@lib/versionDelta";
import { columnKey, defaultReference, versionCell } from "@lib/versionGrid";
import { describe, expect, it } from "vitest";

import type { QualityDay, VersionColumn } from "@lib/interfaces/aiRunTypes";

describe("compareRate", () => {
  it("calls a difference significant when the 95% interval excludes 0", () => {
    const v = compareRate({ hits: 82, total: 133 }, { hits: 131, total: 172 }, BETTER.up);
    expect(v?.significant).toBe(true);
    expect(v?.better).toBe(false);
    expect(v?.delta).toBeCloseTo(-14.5, 1);
  });

  it("does not on a dozen runs", () => {
    expect(compareRate({ hits: 9, total: 14 }, { hits: 131, total: 172 }, BETTER.up)?.significant).toBe(false);
  });

  it("has nothing to say about an empty side", () => {
    expect(compareRate({ hits: 0, total: 0 }, { hits: 1, total: 2 }, BETTER.up)).toBeNull();
  });
});

describe("compareMeasure", () => {
  const side = (value: number, runs: number) => ({ measure: { value, n: runs }, runs });

  it("needs both more than 8% apart and 80 runs a side", () => {
    expect(compareMeasure(side(14.5, 171), side(11, 202), BETTER.down)).toMatchObject({
      significant: true,
      better: false,
    });
    expect(compareMeasure(side(18.5, 19), side(11, 202), BETTER.down)?.significant).toBe(false);
    expect(compareMeasure(side(11.5, 171), side(11, 202), BETTER.down)?.significant).toBe(false);
  });
});

const column = (over: Partial<VersionColumn>): VersionColumn => ({
  version: "spec@v13",
  model: "m",
  firstUs: 0,
  lastUs: 10,
  runs: 200,
  checksPassed: { hits: 190, total: 200 },
  approved: { hits: 150, total: 180 },
  rejected: { hits: 10, total: 180 },
  latencyP50Us: { value: 8_000_000, n: 200 },
  latencyP95Us: { value: 11_000_000, n: 200 },
  firstTokenMs: { value: 1100, n: 300 },
  tokensPerSecond: { value: 200, n: 300 },
  tokensPerRun: { value: 3200, n: 200 },
  ...over,
});

describe("versionGrid", () => {
  const v13 = column({});
  const v14 = column({ version: "spec@v14", firstUs: 5, lastUs: 20, approved: { hits: 100, total: 170 } });

  it("defaults the reference to the version before the newest", () => {
    expect(defaultReference([v13, v14])).toBe(columnKey(v13));
    expect(defaultReference([v13])).toBe(columnKey(v13));
  });

  it("prints the reference plainly and the others with their delta and verdict", () => {
    expect(versionCell(VERSION_ROW.approved, v13, null)).toEqual({ value: "83.3%", delta: null, verdict: null });
    const cell = versionCell(VERSION_ROW.approved, v14, v13);
    expect(cell.value).toBe("58.8%");
    expect(cell.delta).toMatch(/^−24\.5 pts \(CI ±/);
    expect(cell.verdict).toMatchObject({ significant: true, better: false });
  });
});

describe("format", () => {
  it("prints rates, signed deltas and model names", () => {
    expect(formatPct({ hits: 1, total: 3 })).toBe("33.3%");
    expect(formatPct({ hits: 0, total: 0 })).toBe("–");
    expect(signed(-7.24, 1)).toBe("−7.2");
    expect(signed(0.01, 1)).toBe("±0.0");
    expect(deltaPts({ hits: 1, total: 2 }, null)).toBeNull();
    expect(shortModel("Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC")).toBe("Qwen2.5-Coder-7B-q4f16_1");
  });
});

describe("rateChart", () => {
  const day = (i: number, hits: number, total: number): QualityDay => ({
    dayStartUs: i * 86_400_000_000,
    runs: total,
    checksPassed: { hits, total },
    approved: { hits, total },
  });

  it("breaks the line on a day without runs, and floors the axis under the lowest value", () => {
    const chart = rateChart([day(0, 9, 10), day(1, 0, 0), day(2, 6, 10)], []);
    expect(chart.checks).toHaveLength(2);
    expect(chart.floor).toBe(50);
    expect(chart.ticks).toEqual([100, 90, 80, 70, 60, 50]);
  });
});
