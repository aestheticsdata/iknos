import { BUCKET } from "@contracts/traffic";

import type { TrafficBucket } from "@contracts/traffic";
import type { KeyCtx, Slot, TrafficWindow } from "./interfaces/traffic-types";

/**
 * Days and hours in the reader's time zone (spec §5.6).
 *
 * A visitor is counted per calendar day, and "which day" is the reader's: a request at 23:30 UTC
 * is tomorrow morning in Paris. MySQL could only do that with its time-zone tables loaded, which
 * ks-b's server does not have, so the bucketing is done here, through `Intl`.
 *
 * The range itself stays rolling (`now − N`, as every other view computes it). Nothing is snapped
 * to midnight; the daily buckets the range cuts are marked `partial` instead.
 */

export const DEFAULT_TIME_ZONE = "Europe/Paris";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Every real zone's offset is a multiple of fifteen minutes, so stepping by it finds each boundary. */
const STEP_MS = 15 * 60_000;
/** A day of range, plus a minute of slack for the edge moving between two requests. */
const HOURLY_UP_TO_MS = DAY_MS + 60_000;

export const bucketFor = (from: Date, to: Date): TrafficBucket =>
  +to - +from <= HOURLY_UP_TO_MS ? BUCKET.hour : BUCKET.day;

/** The zone if `Intl` accepts it — a browser can send anything — else Paris, where the user is. */
export const safeTimeZone = (tz: string | undefined): string => {
  if (!tz) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
};

/* One formatter per zone, built once: `Intl.DateTimeFormat` construction is the expensive part, and
   a 14-day pass formats every row's timestamp. */
const formatters = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (tz: string) => {
  let formatter = formatters.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(tz, formatter);
  }
  return formatter;
};

const wallClock = (ts: Date, tz: string) => {
  const parts = formatterFor(tz).formatToParts(ts);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "00";
  return { day: `${part("year")}-${part("month")}-${part("day")}`, hour: part("hour") };
};

/** `YYYY-MM-DD` for a daily bucket, `YYYY-MM-DDTHH` for an hourly one. */
export const localKey = (ts: Date, { tz, bucket }: KeyCtx): string => {
  const { day, hour } = wallClock(ts, tz);
  return bucket === BUCKET.day ? day : `${day}T${hour}`;
};

export const localHour = (ts: Date, tz: string): number => Number(wallClock(ts, tz).hour);

/**
 * Every bucket the range touches, oldest first, gap-filled.
 *
 * Found by walking the clock in fifteen-minute steps from a bucket before the range to one after
 * it, and keeping the first instant of each new key: that instant *is* the bucket's local start,
 * including on the 23- and 25-hour days of a clock change, which fixed-width arithmetic gets wrong.
 * Fourteen days is about 1 500 steps.
 */
export const bucketGrid = ({ from, to, tz, retentionDays, now }: TrafficWindow): Slot[] => {
  const bucket = bucketFor(from, to);
  const width = bucket === BUCKET.day ? DAY_MS : HOUR_MS;
  const ctx = { tz, bucket };

  const starts: { key: string; start: number }[] = [];
  const first = Math.floor((+from - width) / STEP_MS) * STEP_MS;
  for (let at = first; at <= +to + width; at += STEP_MS) {
    const key = localKey(new Date(at), ctx);
    if (starts.at(-1)?.key !== key) starts.push({ key, start: at });
  }

  const cut = +now - retentionDays * DAY_MS;
  const slots: Slot[] = [];
  for (let i = 0; i < starts.length - 1; i++) {
    const { key, start } = starts[i];
    const end = starts[i + 1].start;
    if (end <= +from || start >= +to) continue;

    slots.push({
      t: new Date(start).toISOString(),
      key,
      partial: bucket === BUCKET.day && (start < +from || end > +to),
      available: end > cut,
    });
  }
  return slots;
};
