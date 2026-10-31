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

const formatters = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (bucket: TrafficBucket, tz: string) => {
  const key = `${bucket} ${tz}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter =
      bucket === BUCKET.day
        ? new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: tz })
        : new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz });
    formatters.set(key, formatter);
  }
  return formatter;
};

/** `Sat 31 Oct` or `14:00` — what a bar covers, in the zone the server counted it in. */
export const bucketLabel = (point: TrafficPoint, bucket: TrafficBucket, tz: string): string => {
  const label = formatterFor(bucket, tz).format(new Date(point.t)).replace(",", "");
  return point.partial ? `${label} (partial)` : label;
};

/** Visitor-days per day of range — over the range's length, not the bucket count, which has two partial days. */
export const dailyAverage = (totals: TrafficTotals, range: RangeKey): number | null => {
  const minutes = rangeMinutes(range);
  return minutes <= DAY_MINUTES ? null : totals.visitorDays / (minutes / DAY_MINUTES);
};

/** True when the range reaches past what the logs keep, and the oldest buckets are gone. */
export const retentionCut = (range: RangeKey, retentionDays: number): boolean =>
  rangeMinutes(range) > retentionDays * DAY_MINUTES;
