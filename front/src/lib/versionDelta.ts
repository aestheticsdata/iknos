import { BETTER } from "@lib/interfaces/aiRunTypes";

import type { Better, Delta, MeasureSide, Rate } from "@lib/interfaces/aiRunTypes";

/**
 * Is a version's difference from the reference real? (IKN-94) Pure, and the two rules the grid's
 * footnote states:
 *
 * - a **rate** differs when the 95 % confidence interval of the difference of two proportions
 *   (normal approximation, unpooled) excludes zero;
 * - a **measure** — a latency, a throughput — differs when it is more than 8 % away from the
 *   reference *and* both sides rest on at least 80 runs. A mean over a dozen runs moves 8 % on noise.
 */

export const Z_95 = 1.96;
export const MEASURE_THRESHOLD = 0.08;
export const MEASURE_MIN_RUNS = 80;

const direction = (delta: number, better: Better): boolean | null =>
  better === BETTER.none || delta === 0 ? null : delta * better > 0;

/** `null` when either side has no observation to compare. */
export function compareRate(rate: Rate, reference: Rate, better: Better): Delta | null {
  if (rate.total === 0 || reference.total === 0) return null;
  const p1 = rate.hits / rate.total;
  const p2 = reference.hits / reference.total;
  const spread = Z_95 * Math.sqrt((p1 * (1 - p1)) / rate.total + (p2 * (1 - p2)) / reference.total) * 100;
  const delta = (p1 - p2) * 100;
  return { delta, spread, significant: Math.abs(delta) > spread, better: direction(delta, better) };
}

/** `null` when either side has no value. */
export function compareMeasure(side: MeasureSide, reference: MeasureSide, better: Better): Delta | null {
  const value = side.measure.value;
  const base = reference.measure.value;
  if (value === null || base === null || base === 0) return null;
  const delta = value - base;
  const spread = delta / base;
  const enough = Math.min(side.runs, reference.runs) >= MEASURE_MIN_RUNS;
  return {
    delta,
    spread,
    significant: enough && Math.abs(spread) > MEASURE_THRESHOLD,
    better: direction(delta, better),
  };
}

/** A rate as a percentage, `null` with nothing to divide. */
export const ratePct = (rate: Rate): number | null => (rate.total === 0 ? null : (rate.hits / rate.total) * 100);
