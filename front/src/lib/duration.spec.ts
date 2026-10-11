import { describe, expect, it } from "vitest";
import { durationSegments, formatDuration, roundMs } from "./duration";
import { DURATION_UNIT } from "./interfaces/durationTypes";

describe("formatDuration", () => {
  // The ticket's table, row for row (IKN-40).
  it.each([
    [7, "7ms"],
    [900, "900ms"],
    [1000, "1s"],
    [1234, "1.2s"],
    [59_900, "59.9s"],
    [62_000, "1min 02s"],
    [912_871, "15min 13s"],
    [7_500_000, "2h 05min"],
  ])("%i ms reads %s", (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });

  it("promotes at the boundaries instead of printing 60s or 60min", () => {
    expect(formatDuration(59_950)).toBe("1min 00s");
    expect(formatDuration(3_599_600)).toBe("1h 00min");
    expect(formatDuration(999.6)).toBe("1s");
  });

  it("keeps a decimal below 10 ms, and whole milliseconds above", () => {
    expect(formatDuration(4.26)).toBe("4.3ms");
    expect(formatDuration(12.6)).toBe("13ms");
  });

  it("reads 0 as 0ms and null as a dash", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(null)).toBe("–");
  });

  it("does not throw on a negative, which the writer never lets through", () => {
    expect(formatDuration(-5)).toBe("-5ms");
  });

  it("caps at hours — no day unit", () => {
    expect(formatDuration(31 * 3_600_000 + 4 * 60_000)).toBe("31h 04min");
  });
});

describe("durationSegments", () => {
  it("returns the pairs apart, so a unit can be dimmed without its number", () => {
    expect(durationSegments(62_000)).toEqual([
      { value: "1", unit: DURATION_UNIT.min },
      { value: "02", unit: DURATION_UNIT.s },
    ]);
  });

  it("returns nothing for null — the caller draws its own absence", () => {
    expect(durationSegments(null)).toEqual([]);
  });
});

describe("roundMs", () => {
  it("keeps a tenth under 10 ms and rounds whole above", () => {
    expect(roundMs(3.14)).toBe(3.1);
    expect(roundMs(10.4)).toBe(10);
  });
});
