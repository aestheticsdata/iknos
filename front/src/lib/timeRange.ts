/**
 * The global time range — §4 of the UI design doc.
 *
 * One range scopes every view and lives in the URL, so a link to a moment is a link someone else
 * opens on the same moment. That is the whole reason it is not React state.
 *
 * Bounds are computed at call time and never stored: `from`/`to` are mandatory on the logs API
 * (IKN-19) precisely so that every query is partition-pruned, and a pair frozen at render time
 * would quietly stop meaning "the last hour" the moment the tab was left open.
 */

export const RANGE_KEYS = ["15m", "1h", "24h", "7d"] as const;

export type RangeKey = (typeof RANGE_KEYS)[number];

/** An hour: long enough to hold a deploy and its aftermath, short enough to stay fast. */
export const DEFAULT_RANGE: RangeKey = "1h";

const MINUTES: Record<RangeKey, number> = {
  "15m": 15,
  "1h": 60,
  "24h": 24 * 60,
  "7d": 7 * 24 * 60,
};

export const isRangeKey = (value: string | null | undefined): value is RangeKey =>
  value !== null && value !== undefined && (RANGE_KEYS as readonly string[]).includes(value);

export type Bounds = { from: string; to: string };

/**
 * The ISO pair the API wants, ending now.
 *
 * `now` is a parameter rather than a `new Date()` inside, so that a caller rendering on the server
 * and a caller rendering in the browser can be handed the same instant instead of two that differ
 * by the flight time of the page.
 */
export const boundsFor = (key: RangeKey, now: Date = new Date()): Bounds => ({
  from: new Date(now.getTime() - MINUTES[key] * 60_000).toISOString(),
  to: now.toISOString(),
});
