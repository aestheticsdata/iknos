import { DURATION_UNIT } from "@lib/interfaces/durationTypes";

import type { DurationSegment } from "@lib/interfaces/durationTypes";

/**
 * Every duration on screen, in the unit its size calls for (IKN-40): `7ms`, `1.2s`, `15min 13s`,
 * `2h 05min`. Milliseconds are right up to a second and wrong after it — nobody reads `912871 ms`
 * as a quarter of an hour without doing the division by hand.
 *
 * Display only. The raw-event JSON pane, `copy NDJSON` and `report.ts` keep the wire's integer, so
 * they stay diffable against what the API returned.
 *
 * **Round first, then choose the unit from the rounded value.** The other order prints `60s` for
 * 59 950 ms and `60min` for 3 599 600 ms — each step below rounds to its own precision and only
 * then asks whether the result still fits under the next boundary.
 */

const SECOND = 1000;
const MINUTE = 60;
const HOUR = 3600;

/**
 * Whole milliseconds, with one decimal kept below 10 — moved here from the trace timeline (IKN-40).
 *
 * Durations arrive as floats — pino-http writes `12.4183`, and four decimal places in a column read
 * down at 10.5px is noise wearing the costume of precision. Below 10ms the first decimal still
 * separates two numbers someone might act on; above it, it is under the resolution of anything you
 * would change code over.
 */
export const roundMs = (ms: number): number => (Math.abs(ms) < 10 ? Math.round(ms * 10) / 10 : Math.round(ms));

/** Zero-padded, so `1min 02s` keeps one shape down a `tabular-nums` column. */
const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * The duration as one or two number–unit pairs, largest first. `[]` for `null`, so a caller renders
 * its own absence (the log table's `<NoValue />`).
 *
 * A negative is refused by the writer (`writer.ts`) and never reaches here; if one ever does, it is
 * printed in milliseconds rather than thrown on.
 */
export const durationSegments = (ms: number | null): DurationSegment[] => {
  if (ms === null) return [];

  const rounded = roundMs(ms);
  if (rounded < SECOND) return [{ value: String(rounded), unit: DURATION_UNIT.ms }];

  const tenths = Math.round(ms / 100);
  if (tenths < MINUTE * 10) return [{ value: String(tenths / 10), unit: DURATION_UNIT.s }];

  const seconds = Math.round(ms / SECOND);
  if (seconds < HOUR) {
    return [
      { value: String(Math.floor(seconds / MINUTE)), unit: DURATION_UNIT.min },
      { value: pad(seconds % MINUTE), unit: DURATION_UNIT.s },
    ];
  }

  // Seconds dropped past an hour: whole minutes, rounded from the milliseconds and not from the
  // already-rounded seconds, so a value is rounded once.
  const minutes = Math.round(ms / (SECOND * MINUTE));
  return [
    { value: String(Math.floor(minutes / MINUTE)), unit: DURATION_UNIT.h },
    { value: pad(minutes % MINUTE), unit: DURATION_UNIT.min },
  ];
};

/**
 * The same as plain text. A unit binds to its number and only the pairs are spaced — `1min 02s`,
 * never `1 min 02 s`, which reads well in prose and eats a column. `–` for `null`.
 */
export const formatDuration = (ms: number | null): string =>
  ms === null
    ? "–"
    : durationSegments(ms)
        .map((segment) => `${segment.value}${segment.unit}`)
        .join(" ");
