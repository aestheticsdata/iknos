import { ratePct } from "@lib/versionDelta";

import type { Point } from "@lib/charts/interfaces/chartTypes";
import type { QualityDay, QualityMarker, Rate, RateChart } from "@lib/interfaces/aiRunTypes";

/**
 * The quality chart's geometry (IKN-93), pure: two daily rates on one percent axis, with the
 * version changes as vertical marks. A day without runs breaks the line rather than drawing a zero
 * nobody measured.
 */

export const CHART_W = 1000;
export const CHART_H = 200;
const DAY_US = 86_400_000_000;

/** Ten-point gridlines, from a floor ten points under the lowest value — never under 0. */
function floorOf(values: number[]): number {
  if (values.length === 0) return 50;
  return Math.max(0, Math.min(90, Math.floor(Math.min(...values) / 10) * 10 - 10));
}

type Series = (day: QualityDay) => Rate;

function segments(days: QualityDay[], series: Series, floor: number): Point[][] {
  const out: Point[][] = [];
  let current: Point[] = [];
  days.forEach((day, index) => {
    const pct = ratePct(series(day));
    if (pct === null) {
      if (current.length > 0) out.push(current);
      current = [];
      return;
    }
    const x = days.length === 1 ? CHART_W / 2 : (index / (days.length - 1)) * CHART_W;
    current.push({ x, y: ((100 - pct) / (100 - floor)) * CHART_H });
  });
  if (current.length > 0) out.push(current);
  return out;
}

/** `days` oldest first, one per UTC day. Every fourth day is labelled, and the last. */
export function rateChart(days: QualityDay[], markers: QualityMarker[]): RateChart {
  const values = days
    .flatMap((day) => [ratePct(day.checksPassed), ratePct(day.approved)])
    .filter((v): v is number => v !== null);
  const floor = floorOf(values);
  const ticks: number[] = [];
  for (let v = 100; v >= floor; v -= 10) ticks.push(v);

  const first = days[0]?.dayStartUs ?? 0;
  const last = days[days.length - 1]?.dayStartUs ?? first;
  /* A day's point sits at its start; a marker inside the day sits where in the day it fell. */
  const spanUs = Math.max(DAY_US, last - first);
  const labelEvery = 4;

  return {
    floor,
    ticks,
    checks: segments(days, (day) => day.checksPassed, floor),
    approved: segments(days, (day) => day.approved, floor),
    markers: markers
      .map((marker) => ({ ...marker, pct: ((marker.atUs - first) / spanUs) * 100 }))
      .filter((marker) => marker.pct >= 0 && marker.pct <= 100),
    days: days
      .map((day, index) => ({
        pct: days.length === 1 ? 50 : (index / (days.length - 1)) * 100,
        dayStartUs: day.dayStartUs,
        index,
      }))
      .filter((day) => day.index % labelEvery === 0 || day.index === days.length - 1)
      .map(({ pct, dayStartUs }) => ({ pct, dayStartUs })),
  };
}
