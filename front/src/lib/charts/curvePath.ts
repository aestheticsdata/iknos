import type { Point } from "./interfaces/chartTypes";

/**
 * A smooth curve through points that **never overshoots them** (IKN-86).
 *
 * A Catmull-Rom spline through a series that drops to zero dips below the baseline before it climbs
 * back, which on a chart of requests per second draws a negative rate. This is monotone cubic
 * interpolation (Fritsch–Carlson, the same as d3's `curveMonotoneX`): between two points the curve
 * stays between their two values, so a curve over values that are all ≥ 0 never crosses zero.
 *
 * Points must be in increasing x.
 */
export const curvePath = (points: readonly Point[]): string => {
  if (points.length === 0) return "";
  const head = `M${fmt(points[0].x)},${fmt(points[0].y)}`;
  if (points.length === 1) return head;
  if (points.length === 2) return `${head}L${fmt(points[1].x)},${fmt(points[1].y)}`;

  const tangents = tangentsOf(points);
  let d = head;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const third = (b.x - a.x) / 3;
    d += `C${fmt(a.x + third)},${fmt(a.y + third * tangents[i])},${fmt(b.x - third)},${fmt(b.y - third * tangents[i + 1])},${fmt(b.x)},${fmt(b.y)}`;
  }
  return d;
};

/** The same curve closed down to `baseline`, for the area under it. */
export const areaPath = (points: readonly Point[], baseline: number): string => {
  if (points.length < 2) return "";
  const first = points[0];
  const last = points[points.length - 1];
  return `${curvePath(points)}L${fmt(last.x)},${fmt(baseline)}L${fmt(first.x)},${fmt(baseline)}Z`;
};

const fmt = (n: number): string => (Math.round(n * 100) / 100).toString();

const sign = (n: number): number => (n < 0 ? -1 : 1);

/** The slope at each point: zero at a local extremum, and limited so no segment overshoots. */
const tangentsOf = (points: readonly Point[]): number[] => {
  const n = points.length;
  const secants: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    secants.push(dx === 0 ? 0 : (points[i + 1].y - points[i].y) / dx);
  }

  const tangents: number[] = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const h0 = points[i].x - points[i - 1].x;
    const h1 = points[i + 1].x - points[i].x;
    const s0 = secants[i - 1];
    const s1 = secants[i];
    const p = (s0 * h1 + s1 * h0) / (h0 + h1);
    tangents[i] = (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
  }

  // The ends: the one-sided slope the interior tangent next to them implies.
  tangents[0] = (3 * secants[0] - tangents[1]) / 2;
  tangents[n - 1] = (3 * secants[n - 2] - tangents[n - 2]) / 2;
  // An end tangent pointing against its own secant would overshoot; flatten it instead.
  if (sign(tangents[0]) !== sign(secants[0]) || secants[0] === 0) tangents[0] = 0;
  if (sign(tangents[n - 1]) !== sign(secants[n - 2]) || secants[n - 2] === 0) tangents[n - 1] = 0;
  return tangents;
};
