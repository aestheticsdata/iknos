import type { Domain, Point } from "./interfaces/chartTypes";

/**
 * The y axis of a gauge curve (IKN-86).
 *
 * A gauge is read for its shape, so the axis runs from the series' minimum to its maximum. Those
 * two figures are printed beside the axis. A curve with no numbers on it is a squiggle. The drawn
 * domain is padded a little beyond them, so the line's own stroke is not shaved off at the top
 * and the curve's lowest point sits clear of the axis.
 */

/** Room above the highest value and below the lowest, as a share of the span. */
const PAD = 0.1;

/** The known values' extremes, or `null` for a series with none. */
export const extentOf = (values: readonly (number | null)[]): Domain | null => {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (value === null || !Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return min > max ? null : { min, max };
};

/**
 * The domain the curve is drawn on.
 *
 * A flat series has no span to pad, so it gets a band around its value: the line lies across
 * the middle, which reads as steady. A line on the floor would read as zero. Never below zero
 * for a series that never is, so a curve of requests per second cannot appear to dip negative.
 */
export const drawDomain = (extent: Domain): Domain => {
  const span = extent.max - extent.min;
  const pad = span > 0 ? span * PAD : Math.abs(extent.max) * PAD || 1;
  const min = extent.min - pad;
  return { min: extent.min >= 0 ? Math.max(0, min) : min, max: extent.max + pad };
};

/** The y, in pixels from the top of a plot `height` tall, of `value` on `domain`. */
export const yOn = (value: number, domain: Domain, height: number): number => {
  const span = domain.max - domain.min;
  return span > 0 ? height - ((value - domain.min) / span) * height : height / 2;
};

/**
 * The series cut at its holes, each unbroken run as points.
 *
 * A `null` is an interval nobody measured, and a curve drawn across it would join two real
 * readings with a stretch that was never taken. Each run is drawn on its own. A run of one point
 * is kept, and the caller draws it as a dot rather than letting a lone reading vanish.
 */
export const runsOf = (
  values: readonly (number | null)[],
  toPoint: (value: number, index: number) => Point,
): Point[][] => {
  const runs: Point[][] = [];
  let open = false;
  for (const [index, value] of values.entries()) {
    if (value === null || !Number.isFinite(value)) {
      open = false;
      continue;
    }
    if (!open) runs.push([]);
    open = true;
    runs[runs.length - 1].push(toPoint(value, index));
  }
  return runs;
};
