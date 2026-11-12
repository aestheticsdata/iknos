import { BUCKET } from "@lib/interfaces/trafficTypes";
import { ABSENT } from "@lib/serviceFormat";
import { rangeMinutes } from "@lib/timeRange";

import type { TrafficBucket, TrafficPoint, TrafficTotals } from "@lib/interfaces/trafficTypes";
import type { RangeKey } from "@lib/timeRange";

/**
 * The traffic view's numbers, as words (IKN-83). Pure, so the node test run can pin them.
 */

const DAY_MINUTES = 24 * 60;

/** `0.734` → `73%`. */
export const formatShare = (share: number | null): string =>
  share === null || !Number.isFinite(share) ? ABSENT : `${Math.round(share * 100)}%`;

/** Page views per visitor-day, one decimal — the closest honest thing to "pages per visit". */
export const pagesPerVisit = (totals: TrafficTotals): string =>
  totals.visitorDays === 0 ? ABSENT : (totals.pageViews / totals.visitorDays).toFixed(1);

/** The zone the reader counts days in — sent to the API so its days are the reader's days. */
export const readerTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** How long each bucket is, nominally: a clock change makes one local hour or day longer. */
export const BUCKET_MS: Record<TrafficBucket, number> = {
  [BUCKET.s15]: 15_000,
  [BUCKET.m1]: 60_000,
  [BUCKET.m10]: 600_000,
  [BUCKET.h1]: 3_600_000,
  [BUCKET.h2]: 7_200_000,
  [BUCKET.day]: 86_400_000,
};

/** The words beside the hatched swatch: what the bucket in progress is. */
export const CURRENT_BUCKET: Record<TrafficBucket, string> = {
  [BUCKET.s15]: "current 15 s",
  [BUCKET.m1]: "current minute",
  [BUCKET.m10]: "current 10 min",
  [BUCKET.h1]: "current hour",
  [BUCKET.h2]: "current 2 h",
  [BUCKET.day]: "today",
};

/** The three clocks a bucket title is written with. */
const CLOCK = { day: "day", minutes: "minutes", seconds: "seconds" } as const;

type Clock = (typeof CLOCK)[keyof typeof CLOCK];

const formatters = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (kind: Clock, tz: string) => {
  const key = `${kind} ${tz}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter =
      kind === CLOCK.day
        ? new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", timeZone: tz })
        : new Intl.DateTimeFormat("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            ...(kind === CLOCK.seconds ? { second: "2-digit" } : {}),
            hourCycle: "h23",
            timeZone: tz,
          });
    formatters.set(key, formatter);
  }
  return formatter;
};

/**
 * What a bar covers, in the zone the server counted it in: `Sat 7 · 14:00 → 15:00`, or `Sat 31`
 * for a whole day. The tooltip prints it in capitals.
 */
export const bucketTitle = (point: TrafficPoint, bucket: TrafficBucket, tz: string): string => {
  const start = Date.parse(point.t);
  const day = formatterFor(CLOCK.day, tz).format(start).replace(",", "");
  if (bucket === BUCKET.day) return point.partial ? `${day} (partial)` : day;

  const clock = formatterFor(bucket === BUCKET.s15 ? CLOCK.seconds : CLOCK.minutes, tz);
  return `${day} · ${clock.format(start)} → ${clock.format(start + BUCKET_MS[bucket])}`;
};

/** Visitor-days per day of range — over the range's length, not the bucket count, which has two partial days. */
export const dailyAverage = (totals: TrafficTotals, range: RangeKey): number | null => {
  const minutes = rangeMinutes(range);
  return minutes <= DAY_MINUTES ? null : totals.visitorDays / (minutes / DAY_MINUTES);
};

/** True when the range reaches past what the logs keep, and the oldest buckets are gone. */
export const retentionCut = (range: RangeKey, retentionDays: number): boolean =>
  rangeMinutes(range) > retentionDays * DAY_MINUTES;
