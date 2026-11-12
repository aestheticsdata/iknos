import { formatCount } from "@lib/format";
import { ABSENT } from "@lib/serviceFormat";
import { peakOf } from "./barGeometry";

import type { SeriesSummary } from "./interfaces/chartTypes";

/**
 * How a chart writes a number (IKN-86, §7): `6.5` under ten, `18 747` above it, grouped with a
 * narrow no-break space (`formatCount`'s spelling).
 *
 * A whole number under ten stays whole. Most of what these charts count is people and requests,
 * and "3.0 visitors" claims a precision nobody measured.
 */
export const formatChartValue = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) return ABSENT;
  if (Math.abs(value) < 10 && !Number.isInteger(value)) return (Math.round(value * 10) / 10).toFixed(1);
  return formatCount(value);
};

/** `peak 6.5 · avg 1.6`, or nothing when there is no peak to name. */
export const peakAvgLabel = (peak: number, avg: number | null): string | null =>
  peak > 0 && avg !== null ? `peak ${formatChartValue(peak)} · avg ${formatChartValue(avg)}` : null;

/**
 * A chart in one sentence, for the `aria-label` of its `<svg role="img">` (IKN-86, §6):
 * `Visitors, last 7d: 249, peak 6.5 at Sat 7 · 14:00 → 15:00`.
 */
export const seriesSummary = ({ series, span, total, values, bucketName }: SeriesSummary): string => {
  const head = total === null ? `${series}, ${span}` : `${series}, ${span}: ${total}`;
  const peak = peakOf(values);
  if (peak <= 0) return `${head}, nothing recorded`;
  const at = bucketName(values.indexOf(peak));
  return at === null ? `${head}, peak ${formatChartValue(peak)}` : `${head}, peak ${formatChartValue(peak)} at ${at}`;
};
