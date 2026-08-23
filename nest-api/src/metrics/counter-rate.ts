/**
 * Counters → per-interval increments (IKN-13). Prometheus' `increase()`, in the small.
 *
 * A Prometheus counter is a number that only goes up, sampled every fifteen seconds. Nothing about
 * the value itself is interesting — `http_requests_total 41 823` says how many requests the process
 * has served since it started, which is a fact about the last deploy. What the tiles want is the
 * difference between consecutive readings, and three things make that non-trivial:
 *
 * - **The process restarts** and the counter goes back to zero. A naive subtraction produces a
 *   large negative number, which as a rate is nonsense and as a chart is a spike pointing down
 *   through the axis. Prometheus' rule is that a drop *is* the reset, and the new value is itself
 *   the increment — everything served before the restart is lost, and under-counting says so
 *   rather than inventing it. The interval the restart *happened in* is a different problem, and
 *   not one this function can solve: see `restartIntervals`, whose answer is that it cannot be
 *   quoted at all.
 * - **Floating point drifts.** `_sum` series are doubles, and a counter that reports
 *   `999999.9999999` after `1000000` has not reset by a millionth of a request — but a bare
 *   comparison reads it as one and injects the entire counter as a single interval's traffic.
 * - **The collector misses a scrape.** Nothing was lost — the counter kept counting, and the next
 *   reading carries the whole gap — so the walk tracks the previous value it *saw* rather than the
 *   previous interval. What that increment cannot do is be attributed to the interval it lands in,
 *   which is `attributable` below and the caller's job to apply.
 *
 * The last sample of each interval is the one that counts, and the caller supplies one extra
 * interval before the range (index `-1`) to prime the first difference. Without it the first bar of
 * every chart would be empty for no reason a reader could see.
 */

/**
 * One series' reading in one interval.
 *
 * `bucket` is the interval index within the requested range; `-1` is the priming interval
 * immediately before it, whose own increment is discarded.
 *
 * `series` is `labels_hash` — the indexable identity of a label set (IKN-8). It has to be the whole
 * label set and not the tag below: two routes both answering 200 are two counters, and differencing
 * their sum would lose a reset in one of them behind the other one's growth.
 *
 * `tag` is the single label the caller wants the answer grouped by — `le` for a latency histogram,
 * `status_code` for an error rate — or `null` when the whole metric is one group.
 */
export type BucketSample = {
  bucket: number;
  series: string;
  tag: string | null;
  value: number;
};

/** The key an untagged series is grouped under. Not a valid label value, so it cannot collide. */
export const NO_TAG = "";

/**
 * How far a counter may go backwards and still be believed.
 *
 * Relative, not absolute: a millionth of a request off a million is drift, and a millionth of a
 * request off three is not a number anybody can produce. Anything larger than this is taken at
 * face value as a reset, which is Prometheus' rule and the safe direction — a missed reset
 * over-reports by the whole counter, a spurious one over-reports by a hair.
 */
const RESET_TOLERANCE = 1e-9;

/**
 * Per-interval increments, one array per tag, each `bucketCount` long.
 *
 * Zeros, not nulls: this function reports what the counters did, and a counter that did not move
 * genuinely added nothing. Whether an interval was *observed*, and whether its increment can be
 * *attributed* to it, are separate questions with separate sources — `coverage` and `attributable`
 * below — and folding them in here is exactly how "the collector was down" becomes "the service
 * was quiet".
 *
 */
export function increments(samples: BucketSample[], bucketCount: number): Map<string, number[]> {
  const bySeries = new Map<string, BucketSample[]>();
  for (const sample of samples) {
    if (!Number.isFinite(sample.value)) continue;
    const existing = bySeries.get(sample.series);
    if (existing) existing.push(sample);
    else bySeries.set(sample.series, [sample]);
  }

  const out = new Map<string, number[]>();

  for (const readings of bySeries.values()) {
    // Ascending, so the priming interval leads and every difference is against the reading before
    // it. The query returns rows grouped, not ordered, and relying on that would be relying on a
    // `GROUP BY` to sort — which MySQL has not promised since 5.7.
    readings.sort((a, b) => a.bucket - b.bucket);

    const tag = readings[0].tag ?? NO_TAG;
    let line = out.get(tag);
    if (!line) {
      line = Array<number>(bucketCount).fill(0);
      out.set(tag, line);
    }

    let previous: number | null = null;
    for (const reading of readings) {
      /*
       * The first reading of a series contributes nothing.
       *
       * It is a total since the process started, so counting it as an increment would pour hours
       * — or days — of traffic into whichever interval the series first appeared in. A route
       * called for the first time inside the window, or a service whose history begins at the left
       * edge of the chart, would each produce one enormous bar and then a normal line.
       */
      if (previous !== null) {
        const delta = deltaOf(reading.value, previous);
        if (reading.bucket >= 0 && reading.bucket < bucketCount) line[reading.bucket] += delta;
      }
      previous = reading.value;
    }
  }

  return out;
}

/**
 * One difference.
 *
 * A drop is a reset, and the new value is itself the increment — which is right for every interval
 * *after* a restart, whatever the counter did during it. The interval the restart happened in is
 * excluded upstream rather than being special-cased here, because no rule applied to one reading
 * can fix it: some series will have been re-touched after the restart and carry a small new total,
 * and some will not have been and still carry their whole pre-restart lifetime.
 */
function deltaOf(value: number, previous: number): number {
  if (value >= previous) return value - previous;
  // A drop within tolerance is arithmetic, not a restart: the counter did not move.
  if (previous - value <= Math.abs(previous) * RESET_TOLERANCE) return 0;

  return Math.max(0, value);
}

/**
 * Which intervals the service was observed in at all.
 *
 * The distinction this exists to preserve: a scrape that happened and found nothing is a `0` on
 * the chart, and a scrape that never happened is a hole in it. `increments` cannot tell them apart
 * — an idle counter and an unscraped one both fail to move — so the fact is established
 * separately, from a series the exporter publishes whether or not anything has happened.
 */
export function coverage(buckets: number[], bucketCount: number): boolean[] {
  const seen = Array<boolean>(bucketCount).fill(false);
  for (const bucket of buckets) {
    if (bucket >= 0 && bucket < bucketCount) seen[bucket] = true;
  }
  return seen;
}

/**
 * Increments → a per-second rate.
 *
 * **`spanMs` is the time actually measured, not the interval's nominal width.** They are the same
 * whenever scraping is regular, and they are not when it is not — which is the case a rate has to
 * survive. An increment is the traffic between two readings, so the honest divisor is the distance
 * between those two readings; using the bucket's width instead reports a bar with a truncated tail
 * as a lull and the bar after it as a spike, in a matched pair, precisely where the collector
 * faltered. `elapsedOf` measures it.
 */
export function perSecond(increment: number, spanMs: number): number {
  return spanMs > 0 ? (increment * 1000) / spanMs : 0;
}
