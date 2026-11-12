/**
 * The 24h trend: a trailing moving average, in the bars' own unit and on their own axis (IKN-86).
 *
 * That is the only kind of curve allowed over bars. A curve in a different unit would need a
 * second axis, and two axes on one chart let any two lines be made to cross wherever someone wants.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** On a range of an hour or less a day of buckets is the whole chart, so the window shrinks to ten. */
export const SHORT_RANGE_WINDOW = 10;

/** How many buckets the window spans: one day of them, or ten on a short range. */
export const trendWindow = (bucketMs: number, rangeMs: number): number =>
  rangeMs <= HOUR_MS || bucketMs <= 0 ? SHORT_RANGE_WINDOW : Math.max(1, Math.round(DAY_MS / bucketMs));

/**
 * The mean of the last `window` known values at each bucket up to `last`, and `null` after it.
 *
 * Trailing, not centred: a centred average would need buckets that have not happened yet. A bucket
 * past `last` is in the future and gets nothing, so the curve stops where the bars do.
 */
export const movingAverage = (
  values: readonly (number | null)[],
  window: number,
  last: number = values.length - 1,
): (number | null)[] =>
  values.map((_, index) => {
    if (index > last) return null;
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, index - window + 1); j <= index; j++) {
      const value = values[j];
      if (value === null || !Number.isFinite(value)) continue;
      sum += value;
      n++;
    }
    return n === 0 ? null : sum / n;
  });
