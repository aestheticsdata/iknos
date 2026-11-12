import { describe, expect, it } from "vitest";
import { attrText, runStartLabel, sortedAttrs } from "./traceFormat";

describe("runStartLabel", () => {
  it("prints the day and the second, on the given clock", () => {
    const us = Date.parse("2026-11-12T13:02:31.500Z") * 1000;
    expect(runStartLabel(us, "UTC")).toBe("11-12 13:02:31");
    expect(runStartLabel(us, "Europe/Paris")).toBe("11-12 14:02:31");
  });
});

describe("attrText", () => {
  it("prints strings bare and everything else as JSON", () => {
    expect(attrText("plan")).toBe("plan");
    expect(attrText(42)).toBe("42");
    expect(attrText(["stop"])).toBe('["stop"]');
    expect(attrText(false)).toBe("false");
  });
});

describe("sortedAttrs", () => {
  it("orders keys and treats no attributes as none", () => {
    expect(sortedAttrs({ b: 1, a: 2 })).toEqual([
      ["a", 2],
      ["b", 1],
    ]);
    expect(sortedAttrs(null)).toEqual([]);
  });
});
