import type { BarSpan } from "./interfaces/chartTypes";

/**
 * Where bars go, in whole pixels (IKN-86).
 *
 * The charts used to be drawn in bucket units and stretched with `preserveAspectRatio="none"`, so a
 * bar's edge landed wherever the stretch put it and the gap between two bars was a fraction of a
 * pixel that the browser anti-aliased into a grey smear. These charts measure their own width and
 * place each bar on a pixel boundary instead.
 */

/** The gap between two bars. */
export const BAR_GAP_PX = 1;

/**
 * The shortest a non-zero bar is drawn.
 *
 * A quiet hour with one visitor in a week of hundreds is 0.2px tall to scale, which no screen
 * shows. It still happened, so it is drawn.
 */
export const MIN_BAR_PX = 1.5;

/** A bucket in progress gets a little more, so its hatching has room to read. */
export const MIN_PARTIAL_PX = 3;

/**
 * The bar for slot `index` of `count` across `width` pixels.
 *
 * Slot edges are rounded, not the bars, so every bar is the same width to within a pixel and the
 * gaps never collapse. The 1px gap is dropped when a slot is narrower than two pixels: past that
 * point the gaps would eat the bars.
 */
export const barSpan = (index: number, count: number, width: number): BarSpan => {
  const left = Math.round((index * width) / count);
  const right = Math.round(((index + 1) * width) / count);
  const slot = right - left;
  const gap = width / count >= 2 ? BAR_GAP_PX : 0;
  return { x: left, width: Math.max(1, slot - gap) };
};

/** The x of the middle of slot `index`, where the crosshair goes. */
export const slotCenter = (index: number, count: number, width: number): number =>
  count > 0 ? Math.round(((index + 0.5) * width) / count) + 0.5 : 0;

/** Which slot a horizontal offset falls in, clamped to the series. */
export const slotAt = (offset: number, count: number, width: number): number => {
  if (count <= 0 || width <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.floor((offset / width) * count)));
};

/**
 * How tall a bar is, in pixels, on a scale from 0 to `max`.
 *
 * Zero and unknown draw nothing. Anything above zero gets at least `floor`, because a value that
 * exists must be visible.
 */
export const barHeight = (value: number | null, max: number, height: number, floor: number = MIN_BAR_PX): number => {
  if (value === null || !Number.isFinite(value) || value <= 0 || max <= 0) return 0;
  return Math.min(height, Math.max(floor, (value / max) * height));
};

/** The highest known value, or 0. */
export const peakOf = (values: readonly (number | null)[]): number =>
  values.reduce<number>((peak, value) => (value !== null && Number.isFinite(value) && value > peak ? value : peak), 0);

/** The mean of the known values up to and including `last`, or `null` when there are none. */
export const meanOf = (values: readonly (number | null)[], last: number = values.length - 1): number | null => {
  let sum = 0;
  let n = 0;
  for (let i = 0; i <= last && i < values.length; i++) {
    const value = values[i];
    if (value === null || !Number.isFinite(value)) continue;
    sum += value;
    n++;
  }
  return n === 0 ? null : sum / n;
};

/**
 * A series summed into buckets `factor` times wider, oldest first: sixty minutes into twenty bars of
 * three minutes for the rail (IKN-86), where sixty bars would be a pixel each. A trailing remainder
 * is its own, shorter bucket rather than being dropped, so the newest data is never the part that
 * goes missing.
 */
export const foldSum = (values: readonly number[], factor: number): number[] => {
  const size = Math.max(1, Math.floor(factor));
  const folded: number[] = [];
  for (let start = 0; start < values.length; start += size) {
    folded.push(values.slice(start, start + size).reduce((sum, value) => sum + value, 0));
  }
  return folded;
};
