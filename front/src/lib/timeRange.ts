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

/**
 * A week.
 *
 * An hour was picked for query speed and is wrong for how this is actually read. Most services
 * here log only when something happens, so they are silent for hours at a stretch — and an
 * hour-wide window over a quiet service shows an empty list, which reads as an outage rather
 * than as calm. That misreading has already cost one investigation.
 *
 * A week is affordable because nothing in MySQL expires: `IKNOS_RETENTION_DAYS` is validated and
 * read by nothing, there is no partition-maintenance job, and `log_entry` still has the single
 * `p_future` partition it was created with. Every line ever ingested is one query away, so the
 * only cost of a wider default is a heavier query — and what it buys is the difference between
 * "nothing happened" and "nothing happened *recently*", which are not the same answer.
 */
export const DEFAULT_RANGE: RangeKey = "7d";

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

/**
 * Headroom a manual "jump to time" gets above its target — fixed, not scaled by `range`.
 *
 * `boundsAtJump` below pins `to` past the target rather than at it, and this is how far past. Too
 * little and the window is flush against the ceiling again the moment the reader lands on a busy
 * minute; too much and the first page (`PAGE_SIZE` rows, newest first) fills with everything after
 * the target and pushes the target itself off the bottom, which is the scrolling problem "jump to
 * time" exists to remove.
 */
const JUMP_HEADROOM_MINUTES = 10;

/**
 * The window a manual jump pins, given the target instant and the range in force.
 *
 * `from` is exactly what the range buttons would give ending *at* the target — `boundsFor(key,
 * at).from` — so "load more" reaches as far back as the selected range always has. `to` is not:
 * pinning it flush at the target (`boundsFor`'s own behaviour) leaves nothing newer in the fetched
 * page, so the reader who typed `10:00` can scroll toward older lines and nowhere else — the whole
 * bug this function exists to fix. A little headroom past the target is what keeps them from being
 * pinned against their own row.
 */
export const boundsAtJump = (key: RangeKey, at: Date): Bounds => ({
  from: boundsFor(key, at).from,
  to: new Date(at.getTime() + JUMP_HEADROOM_MINUTES * 60_000).toISOString(),
});
