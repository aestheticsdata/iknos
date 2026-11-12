import type { DayStart } from "./interfaces/chartTypes";

/**
 * Time on a chart's x axis (IKN-86): where each day starts on a bucket axis, and the relative ticks
 * under a gauge.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

const dayFormatter = (tz: string) => {
  let formatter = dayFormatters.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "2-digit",
      year: "numeric",
      month: "2-digit",
      timeZone: tz,
    });
    dayFormatters.set(tz, formatter);
  }
  return formatter;
};

/** The calendar day of an instant in `tz`, and its label: `{ key: "2026-11-06", label: "Fri 6" }`. */
const dayOf = (ms: number, tz: string) => {
  const parts = dayFormatter(tz).formatToParts(ms);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return { key: `${part("year")}-${part("month")}-${part("day")}`, label: `${part("weekday")} ${Number(part("day"))}` };
};

/**
 * Every bucket that opens a new day on the reader's clock, for the dashed separators and the
 * `Fri 6` labels under a panel that spans a day or more.
 *
 * The first bucket counts only when it is itself the start of its day. A rolling week begins
 * mid-afternoon, and a separator at the left edge would mark nothing.
 */
export const dayStarts = (starts: readonly number[], bucketMs: number, tz: string): DayStart[] => {
  const days: DayStart[] = [];
  let previous: string | null = null;
  for (const [index, at] of starts.entries()) {
    const day = dayOf(at, tz);
    if (previous === null) {
      if (dayOf(at - bucketMs, tz).key !== day.key) days.push({ index, label: day.label });
    } else if (day.key !== previous) {
      days.push({ index, label: day.label });
    }
    previous = day.key;
  }
  return days;
};

/** A span as an axis tick: `−60m`, `−12h`, `−3.5d`. */
const ago = (ms: number): string => {
  if (ms >= 2 * DAY_MS) return `−${trim(ms / DAY_MS)}d`;
  if (ms >= 2 * HOUR_MS) return `−${trim(ms / HOUR_MS)}h`;
  return `−${trim(ms / MINUTE_MS)}m`;
};

const trim = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** The three ticks under a gauge: the start of the range, its middle, and `now`. */
export const relativeTicks = (spanMs: number): [string, string, string] => [ago(spanMs), ago(spanMs / 2), "now"];
