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

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** Every real zone's offset is a multiple of fifteen minutes, so stepping by it finds each boundary. */
const STEP_MS = 15 * MINUTE_MS;
/** Slack for the edge moving between two requests. */
const SLACK_MS = MINUTE_MS;

/** The nominal width of each bucket. A clock change makes a local day or hour longer or shorter. */
const WIDTH_MS: Record<TrafficBucket, number> = {
  [BUCKET.s15]: 15 * SECOND_MS,
  [BUCKET.m1]: MINUTE_MS,
  [BUCKET.m10]: 10 * MINUTE_MS,
  [BUCKET.h1]: HOUR_MS,
  [BUCKET.h2]: 2 * HOUR_MS,
  [BUCKET.day]: DAY_MS,
};

/** The widest range each bucket serves, smallest first (IKN-86: 60 to 170 bars per range). */
const UP_TO_MS: [TrafficBucket, number][] = [
  [BUCKET.s15, 15 * MINUTE_MS],
  [BUCKET.m1, HOUR_MS],
  [BUCKET.m10, DAY_MS],
  [BUCKET.h1, 7 * DAY_MS],
  [BUCKET.h2, 14 * DAY_MS],
];

export const bucketFor = (from: Date, to: Date): TrafficBucket =>
  UP_TO_MS.find(([, upTo]) => +to - +from <= upTo + SLACK_MS)?.[0] ?? BUCKET.day;

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
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(tz, formatter);
  }
  return formatter;
};

const wallClock = (ts: Date, tz: string) => {
  const parts = formatterFor(tz).formatToParts(ts);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "00";
  return {
    day: `${part("year")}-${part("month")}-${part("day")}`,
    hour: part("hour"),
    minute: part("minute"),
    second: part("second"),
  };
};

/** `n` floored to a multiple of `step`, two digits — the start of the slice of the clock it falls in. */
const floorTo = (n: string, step: number): string => String(Math.floor(Number(n) / step) * step).padStart(2, "0");

/**
 * The bucket's key on the reader's wall clock: `YYYY-MM-DD` for a day, `YYYY-MM-DDTHH` for one or
 * two hours, `…THH:MM` for ten minutes or one, `…THH:MM:SS` for fifteen seconds.
 *
 * From the wall clock rather than from epoch arithmetic, so a ten-minute bucket in a zone at
 * UTC+5:45 still starts at :00, :10 and :20 local.
 */
export const localKey = (ts: Date, { tz, bucket }: KeyCtx): string => {
  const { day, hour, minute, second } = wallClock(ts, tz);
  switch (bucket) {
    case BUCKET.day:
      return day;
    case BUCKET.h2:
      return `${day}T${floorTo(hour, 2)}`;
    case BUCKET.h1:
      return `${day}T${hour}`;
    case BUCKET.m10:
      return `${day}T${hour}:${floorTo(minute, 10)}`;
    case BUCKET.m1:
      return `${day}T${hour}:${minute}`;
    case BUCKET.s15:
      return `${day}T${hour}:${minute}:${floorTo(second, 15)}`;
  }
};

export const localHour = (ts: Date, tz: string): number => Number(wallClock(ts, tz).hour);

/**
 * Every bucket the range touches, oldest first, gap-filled.
 *
 * Found by walking the clock from a bucket before the range to one after it, and keeping the first
 * instant of each new key: that instant *is* the bucket's local start, including on the 23- and
 * 25-hour days of a clock change, which fixed-width arithmetic gets wrong. The step is fifteen
 * minutes, or the bucket's own width when that is narrower. Fourteen days is about 1 300 steps.
 */
export const bucketGrid = ({ from, to, tz, retentionDays, now }: TrafficWindow): Slot[] => {
  const bucket = bucketFor(from, to);
  const width = WIDTH_MS[bucket];
  const step = Math.min(STEP_MS, width);
  const ctx = { tz, bucket };

  const starts: { key: string; start: number }[] = [];
  const first = Math.floor((+from - width) / step) * step;
  for (let at = first; at <= +to + width; at += step) {
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
      partial: start < +from || end > +to,
      available: end > cut,
    });
  }
  return slots;
};
