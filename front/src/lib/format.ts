/**
 * The three shapes the collector chrome puts numbers in — §3.3, and the mockup's own spellings.
 *
 * Kept out of the components because all three appear in more than one place: the byte size is in
 * the ingest card and on every row of the storage panel, the lag is in the pastille and in its
 * tooltip. Two renderings of one number that disagree on their units read as two different
 * numbers, which on this particular panel is the whole failure mode.
 */

const KB = 1000;
const UNITS = ["B", "kB", "MB", "GB", "TB", "PB"] as const;

/**
 * `4.2 GB`, in SI units.
 *
 * SI rather than binary, because both sources this reads from are SI: `information_schema` counts
 * bytes and a VPS is sold in gigabytes that mean 10⁹. Showing `3.9 GiB` beside a hosting invoice
 * that says 20 GB invites the reader to conclude the numbers disagree, when they do not.
 *
 * One decimal below 100, none above: `4.2 GB` and `812 MB` — precision the reader can act on,
 * without a false claim of it.
 */
export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < KB) return `${Math.round(bytes)} B`;

  let value = bytes;
  let unit = 0;
  while (value >= KB && unit < UNITS.length - 1) {
    value /= KB;
    unit += 1;
  }

  return `${value >= 100 ? Math.round(value) : Number(value.toFixed(1))} ${UNITS[unit]}`;
};

/**
 * `10 464`, grouped with a **narrow no-break space** — the mockup's spelling, and the one grouping
 * character that cannot be mistaken for a decimal separator by a reader used to either convention.
 * A plain space would let the number wrap in the middle.
 */
export const formatCount = (n: number): string =>
  Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/**
 * `0.4s` — how the pastille says it, and never more precision than the number carries.
 *
 * Sub-second in tenths because that is the range this normally sits in and a jittering millisecond
 * count in permanent chrome is noise. Past a minute it switches to whole minutes: at that point the
 * exact figure has stopped mattering and the only question is how bad it is.
 */
export const formatLag = (ms: number): string => {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${Number((ms / 1000).toFixed(1))}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
};
