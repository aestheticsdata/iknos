import { type BucketSample, increments, NO_TAG, perSecond } from "./counter-rate";
import { histogramQuantile, type LeBucket, parseLe } from "./histogram-quantile";
import { readLabel } from "./metric-labels";
import { gridStart } from "./metric-window";

import type { Signal, SignalPoint } from "@contracts/service-signals";
import type { SourcePlan } from "./metric-window";

/**
 * Rows → the three signal series (IKN-13), and the one place the null rules are applied.
 *
 * Pure and apart from the queries, for the same reason `service-rail.ts` is: this is the part that
 * would otherwise be wrong in silence. A `GROUP BY` that returns the wrong rows is visible; a rate
 * that divides by the wrong denominator, an error rate that reports `0 %` for an interval nobody
 * called, or a throughput spike manufactured out of the minute the collector was down all look
 * exactly like a service behaving in an interesting way.
 */

/** The counter every request increments, labelled by route, method and status code. */
export const REQUESTS_TOTAL = "http_requests_total";

/** The cumulative latency histogram, labelled by `le` on top of route and method. */
export const DURATION_BUCKET = "http_request_duration_seconds_bucket";

/**
 * The series that proves a scrape happened — and, from its value, when the process restarted.
 *
 * Standard across every Prometheus client, published from the first scrape whether or not the
 * process has done anything, and — unlike the two counters above — present for a service that has
 * never served a request. Two properties fall out of that: an interval it appears in was observed,
 * and an interval in which its *value* changes is an interval the process started afresh in.
 */
export const PROCESS_START = "process_start_time_seconds";

export const METRIC_NAMES = [REQUESTS_TOTAL, DURATION_BUCKET, PROCESS_START] as const;

/** Prometheus reports durations in seconds; every latency in this product is milliseconds. */
const SECONDS_TO_MS = 1000;

const P95 = 0.95;

/** One stored sample, whichever table it came out of. */
export type MetricRow = {
  bucket: number;
  /**
   * When the reading was taken, in epoch milliseconds.
   *
   * Carried out of SQL rather than collapsed into the bucket index, because the bucket index is not
   * enough to divide by: an increment is the traffic between two readings, and the honest divisor
   * is the distance between *those readings* rather than the width of the bar they land on. The two
   * agree while scraping is regular and part company the moment it is not — see `elapsedOf`.
   */
  ts: number;
  name: string;
  /** `labels_hash` — the indexable identity of a series. */
  series: string;
  /** The stored label set, still as the driver handed it over. */
  labels: unknown;
  value: number;
};

export type SignalSet = {
  throughput: Signal;
  errorRate: Signal;
  p95: Signal;
};

/**
 * A 5xx, and nothing else.
 *
 * The tile counts server errors because they are the ones that are the service's fault. A 401 on a
 * mistyped password and a 404 on an expired export are the application working exactly as designed,
 * and a tile that goes amber every time somebody signs in badly is a tile that is ignored by the
 * end of the week. The full status-code split belongs to the metrics view (design doc §5.3).
 */
const isServerError = (tag: string): boolean => tag.startsWith("5");

export function buildSignals(rows: MetricRow[], from: Date, plan: SourcePlan): SignalSet {
  const { bucketMs, buckets } = plan;

  const heartbeat = rows.filter((row) => row.name === PROCESS_START);
  /*
   * The heartbeat is the clock, and every other series is only evidence of itself.
   *
   * An exporter that publishes no `process_start_time_seconds` falls back to whatever rows there
   * are, which is weaker in one way — an interval in which a service was scraped but had nothing to
   * report looks unobserved — and correct in every other.
   */
  const clock = heartbeat.length > 0 ? heartbeat : rows;
  // Only the real heartbeat can see a restart. Without one the value-drop rule is all there is,
  // which is the behaviour every Prometheus consumer has and is no worse than it was.
  const restarts = heartbeat.length > 0 ? restartIntervals(heartbeat) : new Set<number>();

  /*
   * How long each interval actually measured, and — because a `null` there means there was nothing
   * to measure between — which intervals can be quoted at all.
   *
   * The one exclusion `elapsedOf` cannot make is the interval a restart happened in: its counters
   * disagree about which process they describe, whatever the clock says. See `restartIntervals`.
   */
  const elapsed = elapsedOf(clock, buckets);
  const usable = elapsed.map((ms, index) => ms !== null && !restarts.has(index));

  const requests = increments(samplesFor(rows, REQUESTS_TOTAL, "status_code"), buckets);
  const durations = increments(samplesFor(rows, DURATION_BUCKET, "le"), buckets);

  const totals = sumLines(requests, () => true, buckets);
  const errors = sumLines(requests, isServerError, buckets);

  return {
    throughput: throughputOf(totals, usable, elapsed, from, bucketMs),
    errorRate: errorRateOf(errors, totals, usable, from, bucketMs),
    p95: p95Of(durations, usable, from, bucketMs, buckets),
  };
}

/**
 * The intervals in which the process started afresh — which are the intervals that cannot be
 * quoted at all.
 *
 * `process_start_time_seconds` is a constant for the life of a process, so a change in it between
 * two readings is a restart, visible whether or not the counters happened to end up lower.
 *
 * What makes the interval unquotable rather than merely awkward is that its series disagree about
 * which process they are describing. The query keeps the *last* reading of each series in each
 * interval, and a Prometheus client only publishes a labelled child once that label has been
 * touched — so after a restart, a route that has been called again reports a small new total while
 * one that has not is still sitting at its whole pre-restart lifetime, unchanged since before. Any
 * rule applied per reading gets one of the two wrong, and treating them all as resets injects a
 * quiet route's entire history as one interval of traffic.
 *
 * So the interval says nothing, and the intervals after it are correct on the ordinary drop rule:
 * a quiet route's next reading *is* lower than the total it was carrying, which is exactly a reset.
 * What is lost is the traffic during the seconds a deploy was in flight.
 */
export function restartIntervals(heartbeat: MetricRow[]): Set<number> {
  const restarts = new Set<number>();

  /*
   * Grouped by series first, even though `process_start_time_seconds` carries no labels and is
   * therefore one series on every exporter seen here. It costs three lines, and without them an
   * exporter that did label it would interleave two ascending sequences into one and read every
   * alternation between them as a restart — a chart of nothing but spikes, from a guard.
   */
  const bySeries = new Map<string, MetricRow[]>();
  for (const row of heartbeat) {
    const existing = bySeries.get(row.series);
    if (existing) existing.push(row);
    else bySeries.set(row.series, [row]);
  }

  for (const readings of bySeries.values()) {
    readings.sort((a, b) => a.bucket - b.bucket);

    let previous: number | null = null;
    for (const reading of readings) {
      if (previous !== null && reading.value !== previous) restarts.add(reading.bucket);
      previous = reading.value;
    }
  }

  return restarts;
}

/**
 * How much time each interval actually measured, in milliseconds — and `null` where it measured
 * none.
 *
 * The increment credited to an interval is the traffic between the last reading before it and the
 * last reading inside it. Dividing that by the interval's nominal width is right only while those
 * two readings are exactly one width apart, and a collector that stumbles for twenty seconds breaks
 * that in a way no bucket index can see: the interval loses its tail scrape, so its increment covers
 * less time than the bar it is drawn on and reads as a lull, and the next interval's covers more and
 * reads as a spike. A matched dip and spike, at exactly the moment the collection faltered.
 *
 * Measuring instead of assuming makes both correct, and it is what `rate()` does: the divisor is the
 * distance between the two samples the difference was taken from. It also makes the trailing
 * interval right for free — a range that ends part-way through a bar no longer needs a special case,
 * because the bar reports the rate over the stretch it actually saw.
 *
 * `null` for an interval with no reading of its own, and for the first one when nothing precedes it:
 * in both cases there is no pair to measure between, which is precisely when a rate cannot be
 * quoted.
 */
export function elapsedOf(readings: MetricRow[], buckets: number): (number | null)[] {
  // The last reading in each interval, which is the one every difference is taken to.
  const last = new Map<number, number>();
  for (const row of readings) {
    const seen = last.get(row.bucket);
    if (seen === undefined || row.ts > seen) last.set(row.bucket, row.ts);
  }

  const indices = [...last.keys()].sort((a, b) => a - b);

  return Array.from({ length: buckets }, (_, index) => {
    const here = last.get(index);
    if (here === undefined) return null;

    // The nearest earlier interval that has one — which may be several back, when the collector was
    // away. Spreading the increment over that whole stretch is the honest reading of it.
    const previous = indices.filter((i) => i < index).pop();
    if (previous === undefined) return null;

    const span = here - (last.get(previous) as number);
    return span > 0 ? span : null;
  });
}

/** The rows of one metric, tagged by the one label that metric is grouped by. */
export function samplesFor(rows: MetricRow[], name: string, tag: string): BucketSample[] {
  return rows
    .filter((row) => row.name === name)
    .map((row) => ({ bucket: row.bucket, series: row.series, tag: readLabel(row.labels, tag), value: row.value }));
}

/** The per-interval sum of every tag the predicate keeps. */
export function sumLines(lines: Map<string, number[]>, keep: (tag: string) => boolean, buckets: number): number[] {
  const out = Array<number>(buckets).fill(0);
  for (const [tag, line] of lines) {
    if (!keep(tag)) continue;
    for (let i = 0; i < buckets; i += 1) out[i] += line[i];
  }
  return out;
}

const pointsOf = (values: (number | null)[], from: Date, bucketMs: number): SignalPoint[] =>
  values.map((v, i) => ({ t: gridStart(from, bucketMs, i).toISOString(), v }));

export function throughputOf(
  totals: number[],
  usable: boolean[],
  elapsed: (number | null)[],
  from: Date,
  bucketMs: number,
): Signal {
  // Divided by what was measured, never by the bar's width — see `elapsedOf`.
  const values = totals.map((total, i) => (usable[i] ? perSecond(total, elapsed[i] as number) : null));

  /*
   * The headline is divided by the time actually measured, not by the width of the range.
   *
   * A window the collector slept through half of has half the requests it would otherwise have
   * counted, and dividing those by the full span would report the service as half as busy as it
   * was. Summing the intervals that can be quoted, and the seconds they cover, says what was seen —
   * which is the only thing this number can honestly claim.
   */
  const measured = elapsed.reduce((sum: number, ms, i) => (usable[i] ? sum + (ms as number) : sum), 0);
  const total = totals.reduce((sum, value, i) => (usable[i] ? sum + value : sum), 0);

  return { value: measured === 0 ? null : perSecond(total, measured), points: pointsOf(values, from, bucketMs) };
}

export function errorRateOf(
  errors: number[],
  totals: number[],
  usable: boolean[],
  from: Date,
  bucketMs: number,
): Signal {
  // A rate with an empty denominator is undefined, not zero: an interval nobody called had no
  // errors and also had no successes, and `0 %` there is a claim about a sample size of none.
  const values = totals.map((total, i) => (usable[i] && total > 0 ? (errors[i] / total) * 100 : null));

  const seenErrors = errors.reduce((sum, value, i) => (usable[i] ? sum + value : sum), 0);
  const seenTotal = totals.reduce((sum, value, i) => (usable[i] ? sum + value : sum), 0);

  return {
    value: seenTotal > 0 ? (seenErrors / seenTotal) * 100 : null,
    points: pointsOf(values, from, bucketMs),
  };
}

/**
 * The p95, per interval and over the range.
 *
 * The range figure is **not** the mean of the per-interval ones. A percentile of percentiles is not
 * a percentile of anything: it weights a quiet minute exactly as heavily as a busy one, and it
 * reads low precisely when a single interval has gone bad — which is the case the headline exists
 * to catch. So the increments of every interval are added back into one histogram and the quantile
 * is taken once, which is the number Prometheus would give for the whole window.
 *
 * A percentile needs no denominator of time, so it is immune to the partial-interval problem the
 * throughput has — but it is not immune to the attribution one, and an interval whose increments
 * are three minutes of requests is left out for the same reason.
 */
export function p95Of(
  durations: Map<string, number[]>,
  usable: boolean[],
  from: Date,
  bucketMs: number,
  buckets: number,
): Signal {
  const perBucket: (number | null)[] = [];
  const whole = new Map<number, number>();

  for (let i = 0; i < buckets; i += 1) {
    const leBuckets: LeBucket[] = [];

    for (const [tag, line] of durations) {
      const le = parseLe(tag === NO_TAG ? null : tag);
      if (le === null) continue;

      leBuckets.push({ le, count: line[i] });
      if (usable[i]) whole.set(le, (whole.get(le) ?? 0) + line[i]);
    }

    const quantile = usable[i] ? histogramQuantile(P95, leBuckets) : null;
    perBucket.push(quantile === null ? null : quantile * SECONDS_TO_MS);
  }

  const overall = histogramQuantile(
    P95,
    [...whole].map(([le, count]) => ({ le, count })),
  );

  return { value: overall === null ? null : overall * SECONDS_TO_MS, points: pointsOf(perBucket, from, bucketMs) };
}
