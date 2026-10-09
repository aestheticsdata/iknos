import { describe, expect, it } from "vitest";
import { tickIndices } from "./chartTicks";

describe("tickIndices", () => {
  it("spreads the ticks evenly, both ends included", () => {
    expect(tickIndices(60, 5)).toEqual([0, 15, 30, 44, 59]);
  });

  it("labels every point when there are fewer points than ticks", () => {
    expect(tickIndices(3, 5)).toEqual([0, 1, 2]);
  });

  it("degrades to one label, or none", () => {
    expect(tickIndices(10, 1)).toEqual([0]);
    expect(tickIndices(0, 5)).toEqual([]);
  });
});
