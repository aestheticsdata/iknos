import { describe, expect, it } from "vitest";
import { areaOf, barIndexAt, layoutOf, pointIndexAt, pointsOf, runsOf } from "./series";

/**
 * The geometry the chart primitives share (IKN-13).
 *
 * A guard rather than TDD output. Every failure this covers is silent: a flat series that divides
 * by zero renders as `NaN` and disappears, which looks exactly like having no data; and a series
 * with holes drawn as one line joins two real measurements with a segment nobody measured, which
 * is the most confident thing a chart can draw.
 */

describe("runsOf", () => {
  it("splits a series on its holes, keeping where each stretch starts", () => {
    expect(runsOf([1, 2, null, 4, 5])).toEqual([
      { start: 0, values: [1, 2] },
      { start: 3, values: [4, 5] },
    ]);
  });

  it("keeps a lone reading as a run of one rather than dropping it", () => {
    // Dropping it here would silently turn "one reading" into "no readings"; what to draw for a
    // run of one is the component's decision, and both of them draw a dot.
    expect(runsOf([null, 7, null])).toEqual([{ start: 1, values: [7] }]);
  });

  it("has no runs for a series that is nothing but holes", () => {
    expect(runsOf([null, null])).toEqual([]);
    expect(runsOf([])).toEqual([]);
  });

  it("treats a non-finite reading as a hole", () => {
    expect(runsOf([1, Number.NaN, 3])).toEqual([
      { start: 0, values: [1] },
      { start: 2, values: [3] },
    ]);
  });
});

describe("layoutOf", () => {
  it("spreads the points across the box and insets the extremes", () => {
    const layout = layoutOf([0, 10], 100, 26, "min");

    expect(layout.x(0)).toBe(0);
    expect(layout.x(1)).toBe(100);
    // 1px of inset top and bottom, so a peak is not shaved in half by the viewBox.
    expect(layout.y(10)).toBe(1);
    expect(layout.y(0)).toBe(25);
  });

  it("draws a flat series down the middle instead of dividing by zero", () => {
    // A constant 412ms drawn along the bottom reads as the fastest the service has ever been. The
    // one unacceptable answer is the division by zero, which renders the path as `NaN` and
    // disappears — indistinguishable from having no data at all.
    const layout = layoutOf([412, 412, 412], 100, 26, "min");

    expect(layout.y(412)).toBe(13);
    expect(Number.isNaN(layout.y(412))).toBe(false);
  });

  it("keeps a series that is flat at zero on the floor", () => {
    // The rail is full of services that are honestly silent for hours, and a line through the
    // middle of their sparkline would read as steady traffic.
    const layout = layoutOf([0, 0, 0], 100, 26, "min");

    expect(layout.y(0)).toBe(25);
  });

  it("starts a zero-based series at zero, however high its floor is", () => {
    // An area drawn from the series' own minimum fills the box whatever the numbers are, so a
    // service serving one request a minute and one serving a thousand look identical.
    const layout = layoutOf([80, 100], 100, 26, "zero");

    expect(layout.min).toBe(0);
    expect(layout.base).toBe(25);
    expect(layout.y(0)).toBe(25);
  });

  it("keeps a shape-scaled series on its own floor, so small variation is still visible", () => {
    const layout = layoutOf([405, 412], 100, 26, "min");

    expect(layout.min).toBe(405);
    expect(layout.y(405)).toBe(25);
    expect(layout.y(412)).toBe(1);
  });

  it("puts a lone point at the left edge rather than at infinity", () => {
    const layout = layoutOf([5], 100, 26, "min");

    expect(layout.x(0)).toBe(0);
    expect(Number.isFinite(layout.x(0))).toBe(true);
  });
});

describe("pointsOf and areaOf", () => {
  const layout = layoutOf([0, 5, 10], 100, 26, "zero");

  it("writes a run as SVG points at two decimals", () => {
    expect(pointsOf({ start: 0, values: [0, 5, 10] }, layout)).toBe("0.00,25.00 50.00,13.00 100.00,1.00");
  });

  it("closes an area on its own run, so a hole in the series is a hole in the fill", () => {
    // Closing on the box instead would continue the fill under the gap, claiming volume for an
    // interval nobody measured.
    const area = areaOf({ start: 1, values: [5, 10] }, layout);

    expect(area.startsWith("M50.00,25.00 L")).toBe(true);
    expect(area.endsWith("L100.00,25.00 Z")).toBe(true);
  });
});

/**
 * Which mark the pointer is over (IKN-15's tooltips).
 *
 * The same class of silent failure as the rest of this file: an index one past the end is
 * `undefined` to the caller, which reaches the reader as a bubble with nothing in it, and a
 * zero-width box divides by zero and answers `NaN`, which as an index is the same thing. Both are
 * reachable by pointing at the right-hand edge of a chart, which is where the newest bar is.
 */
const BOX = { left: 100, width: 200 };

describe("barIndexAt", () => {
  it("gives a bar the whole of its own slot", () => {
    // Ten bars across 200px: each owns twenty, and the boundary belongs to the bar on its right.
    expect(barIndexAt(100, BOX, 10)).toBe(0);
    expect(barIndexAt(119, BOX, 10)).toBe(0);
    expect(barIndexAt(120, BOX, 10)).toBe(1);
  });

  it("keeps the last bar at the right-hand edge instead of one past the end", () => {
    expect(barIndexAt(300, BOX, 10)).toBe(9);
  });

  it("clamps a pointer outside the box rather than reporting a negative index", () => {
    expect(barIndexAt(0, BOX, 10)).toBe(0);
    expect(barIndexAt(9999, BOX, 10)).toBe(9);
  });

  it("answers 0 for a box with no width, which is a chart measured before layout", () => {
    expect(barIndexAt(50, { left: 0, width: 0 }, 10)).toBe(0);
  });

  it("answers 0 for an empty series rather than -1", () => {
    expect(barIndexAt(150, BOX, 0)).toBe(0);
  });
});

describe("pointIndexAt", () => {
  it("snaps to the nearest vertex, not to the one on its left", () => {
    // Five points across 200px sit every 50px. Just past the midpoint between two of them, the
    // nearest is the one on the right — which flooring would get wrong for half of every gap.
    expect(pointIndexAt(100, BOX, 5)).toBe(0);
    expect(pointIndexAt(124, BOX, 5)).toBe(0);
    expect(pointIndexAt(126, BOX, 5)).toBe(1);
    expect(pointIndexAt(300, BOX, 5)).toBe(4);
  });

  it("puts a single point under the whole box", () => {
    expect(pointIndexAt(100, BOX, 1)).toBe(0);
    expect(pointIndexAt(300, BOX, 1)).toBe(0);
  });
});
