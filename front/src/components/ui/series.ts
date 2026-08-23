/**
 * The geometry the three chart primitives share — IKN-13, the dataviz set ported from PFA.
 *
 * A sparkline's arithmetic is four lines and every one of them has a way of being quietly wrong: a
 * flat series divides by zero and renders as `NaN`, which looks identical to no data; a peak at the
 * extreme is shaved in half by the viewBox; and a series with holes in it, drawn as one polyline,
 * joins the two sides of the gap with a straight line that reads as measured.
 *
 * That last one is why this module exists at all. `Signal.points` carries `null` for an interval
 * that cannot be quoted — the collector was down, or the counter had no predecessor — and a chart
 * that bridges those is asserting a measurement nobody took. The runs below are what keep the gap a
 * gap.
 */

/** `null` is an interval with no answer, and never a zero. */
export type SeriesValue = number | null;

/**
 * Where the vertical axis starts.
 *
 * `zero` for anything whose magnitude is the point — a volume, a rate, a count. An area drawn from
 * the series' own minimum fills the box whatever the numbers are, so a service serving one request
 * a minute and one serving a thousand look the same.
 *
 * `min` for anything whose *shape* is the point. A p95 that sits between 405ms and 412ms all day is
 * a flat line against a zero baseline, and every bit of the variation a reader is looking for is
 * lost in the bottom pixel.
 */
export type Baseline = "zero" | "min";

/** One contiguous run of known values, and where in the series it starts. */
export type Run = {
  start: number;
  values: number[];
};

export type Layout = {
  /** The x of a point, by its index in the whole series. */
  x: (index: number) => number;
  /** The y of a value, inset so an extreme is not clipped in half by the viewBox. */
  y: (value: number) => number;
  /** The y of the baseline — where an area is filled down to. */
  base: number;
  runs: Run[];
  min: number;
  max: number;
};

/** Top and bottom inset, in user units: a value at either extreme would otherwise be half-clipped. */
const INSET = 1;

/**
 * The layout for one series in one box.
 *
 * `width` and `height` are user units of the `viewBox`, not pixels — every chart here is drawn with
 * `preserveAspectRatio="none"` and stretched to whatever its container is, so the box is a
 * coordinate space rather than a size.
 */
export const layoutOf = (values: SeriesValue[], width: number, height: number, baseline: Baseline = "min"): Layout => {
  const known = values.filter((value): value is number => value !== null && Number.isFinite(value));

  const seriesMin = known.length > 0 ? Math.min(...known) : 0;
  const seriesMax = known.length > 0 ? Math.max(...known) : 0;

  const min = baseline === "zero" ? Math.min(0, seriesMin) : seriesMin;
  const max = seriesMax;
  const span = max - min || 1;

  // One point cannot be spread across the box, and dividing by zero would put it at `Infinity`.
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;
  const usable = height - INSET * 2;

  const floor = INSET + usable;
  /*
   * A series with no range at all has nothing to divide by, and where it belongs depends on what it
   * is flat *at*.
   *
   * At zero it goes on the floor: that is what "nothing happened" looks like, and the rail is full
   * of services which are honestly silent for hours. Anywhere else it goes down the middle — a p95
   * that sat at 412ms all afternoon drawn along the bottom reads as the fastest the service has
   * ever been, which is the opposite of what it says.
   *
   * Either way it is drawn. The one unacceptable answer is the division by zero, which renders the
   * whole path as `NaN` and disappears — indistinguishable from having no data.
   */
  const y = (value: number): number =>
    max === min ? (max === 0 ? floor : INSET + usable / 2) : INSET + usable - ((value - min) / span) * usable;

  return {
    x: (index) => index * stepX,
    y,
    base: y(Math.max(min, 0)),
    runs: runsOf(values),
    min,
    max,
  };
};

/**
 * The series split into its unbroken stretches.
 *
 * Each becomes its own `<polyline>`, so the chart shows two lines with a gap between them rather
 * than one line that walks across the hole. A run of a single point is kept — the caller decides
 * whether one point is worth a dot or worth nothing — because dropping it here would silently turn
 * "one reading" into "no readings".
 */
export const runsOf = (values: SeriesValue[]): Run[] => {
  const runs: Run[] = [];
  let open = false;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];

    if (value === null || !Number.isFinite(value)) {
      open = false;
      continue;
    }

    if (!open) {
      runs.push({ start: index, values: [] });
      open = true;
    }
    runs[runs.length - 1].values.push(value);
  }

  return runs;
};

/** A run as SVG `points`. Two decimals: more is bytes nobody can see. */
export const pointsOf = (run: Run, layout: Layout): string =>
  run.values
    .map((value, offset) => `${layout.x(run.start + offset).toFixed(2)},${layout.y(value).toFixed(2)}`)
    .join(" ");

/**
 * A run as a closed area, dropped to the baseline at both ends.
 *
 * Closed on the run rather than on the box, so a gap in the series is a gap in the fill too — an
 * area that continued under the hole would be claiming volume for an interval nobody measured.
 */
export const areaOf = (run: Run, layout: Layout): string => {
  const first = layout.x(run.start);
  const last = layout.x(run.start + run.values.length - 1);

  return `M${first.toFixed(2)},${layout.base.toFixed(2)} L${pointsOf(run, layout).split(" ").join(" L")} L${last.toFixed(2)},${layout.base.toFixed(2)} Z`;
};
