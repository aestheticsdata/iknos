import { describe, expect, it } from "vitest";
import { RateWindow, WINDOW_MINUTES } from "./rate-window";

const MINUTE = 60_000;
/** An arbitrary minute boundary, so the arithmetic below reads as offsets from it. */
const T0 = Date.parse("2026-08-21T12:00:00Z");

describe("RateWindow", () => {
  it("knows nothing before the first line, and says so with null rather than zero", () => {
    const w = new RateWindow();
    expect(w.snapshot(T0)).toBeNull();
  });

  it("fills the whole window, oldest first, once it has seen anything", () => {
    const w = new RateWindow();
    w.record(T0, 5, 500);

    const snapshot = w.snapshot(T0);
    expect(snapshot?.lines).toHaveLength(WINDOW_MINUTES);
    // The current minute is the last bucket; everything before it is a real zero.
    expect(snapshot?.lines.at(-1)).toBe(5);
    expect(snapshot?.lines.slice(0, -1).every((n) => n === 0)).toBe(true);
  });

  it("accumulates repeated writes inside one minute", () => {
    const w = new RateWindow();
    w.record(T0, 5, 500);
    w.record(T0 + 30_000, 7, 700);

    const snapshot = w.snapshot(T0 + 30_000);
    expect(snapshot?.lines.at(-1)).toBe(12);
    expect(snapshot?.bytes).toBe(1200);
  });

  it("separates minutes and zero-fills the quiet ones between them", () => {
    const w = new RateWindow();
    w.record(T0, 5, 50);
    w.record(T0 + 3 * MINUTE, 9, 90);

    const snapshot = w.snapshot(T0 + 3 * MINUTE);
    expect(snapshot?.lines.slice(-4)).toEqual([5, 0, 0, 9]);
    expect(snapshot?.total).toBe(14);
  });

  it("scrolls: a minute older than the window falls out of the totals", () => {
    const w = new RateWindow();
    w.record(T0, 5, 50);
    w.record(T0 + WINDOW_MINUTES * MINUTE, 9, 90);

    const snapshot = w.snapshot(T0 + WINDOW_MINUTES * MINUTE);
    expect(snapshot?.total).toBe(9);
    expect(snapshot?.bytes).toBe(90);
    expect(snapshot?.lines.at(-1)).toBe(9);
  });

  it("empties out after a whole quiet window, without forgetting that it has data", () => {
    const w = new RateWindow();
    w.record(T0, 5, 50);

    // Two windows later: everything recorded has scrolled off, but the collector is still up and
    // the honest answer is a flat zero line — not `null`, which means "no idea yet".
    const snapshot = w.snapshot(T0 + 2 * WINDOW_MINUTES * MINUTE);
    expect(snapshot?.total).toBe(0);
    expect(snapshot?.lines.every((n) => n === 0)).toBe(true);
  });

  it("does not let a clock that went backwards corrupt the window", () => {
    const w = new RateWindow();
    w.record(T0 + 10 * MINUTE, 5, 50);
    // NTP stepping the clock back, or a snapshot taken a hair before the write that preceded it.
    w.record(T0, 3, 30);

    const snapshot = w.snapshot(T0 + 10 * MINUTE);
    expect(snapshot?.lines).toHaveLength(WINDOW_MINUTES);
    expect(snapshot?.total).toBeGreaterThanOrEqual(5);
  });
});
