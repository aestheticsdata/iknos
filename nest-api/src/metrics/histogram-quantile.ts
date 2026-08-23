/**
 * `histogram_quantile`, transcribed (IKN-13).
 *
 * This is the one piece of the service view that is easy to get plausibly wrong. `_sum / _count`
 * is right there in the same exposition, it is one division, and it produces a number that looks
 * exactly like a p95 and is a mean — which under a bimodal latency distribution (the fast path and
 * the one route holding a connection for eight seconds) is lower than the median and moves in the
 * wrong direction when things get worse. The whole reason `metric_sample` stores the `_bucket`
 * parts untouched is so that this function can exist.
 *
 * The algorithm is Prometheus' `bucketQuantile` and deliberately not a tidied-up version of it:
 * the same sort, the same monotonicity repair, the same treatment of the `+Inf` bucket, the same
 * linear interpolation inside the chosen bucket. Anywhere Prometheus returns `NaN`, this returns
 * `null` — the project's word for "I do not know", and the value the tile renders as an em dash
 * rather than as a zero.
 *
 * What it is **not** is an accurate quantile. It is an interpolation over the bounds prom-client
 * was configured with, so a p95 that lands in the `0.5 → 1` bucket is a guess somewhere in half a
 * second of range. The metrics view footnotes exactly this (design doc §5.3), and that footnote is
 * the difference between a number someone acts on and a number someone believes.
 */

/**
 * One cumulative bucket: every observation at or below `le`.
 *
 * `le` is `Infinity` for the `+Inf` bucket — the string the exposition format uses is the
 * caller's problem, and it has to be parsed before it gets here so that the sort below is
 * numeric rather than lexicographic (`"10"` sorts before `"5"` as a string, which would silently
 * reverse the top of every histogram).
 */
export type LeBucket = {
  le: number;
  count: number;
};

/**
 * The quantile, or `null` when the buckets cannot answer.
 *
 * `null` for: fewer than two buckets, no `+Inf` bucket at all, and no observations. The last is the
 * common one and the reason the tile has an empty state — a range in which the service served
 * nothing has no p95, and drawing `0ms` for it would report an idle afternoon as the fastest the
 * service has ever been.
 */
export function histogramQuantile(q: number, input: LeBucket[]): number | null {
  if (!Number.isFinite(q) || q < 0 || q > 1) return null;

  const buckets = ensureMonotonic(coalesce(input));
  if (buckets.length < 2) return null;

  const last = buckets[buckets.length - 1];
  // Without the open-ended bucket there is no total to take a rank of: the observations past the
  // highest finite bound are exactly the ones a high quantile is about, and a histogram that does
  // not count them cannot be asked where its 95th percentile is.
  if (last.le !== Number.POSITIVE_INFINITY) return null;

  const observations = last.count;
  if (observations <= 0) return null;

  let rank = q * observations;
  const index = buckets.findIndex((bucket) => bucket.count >= rank);
  // `findIndex` cannot fail here — the last bucket's count *is* `observations` and `q <= 1` — but
  // a defensive branch costs nothing and beats an out-of-range read if that ever stops holding.
  if (index === -1) return null;

  /*
   * The quantile falls in `+Inf`: everything is known about those observations except how large
   * they are. Prometheus returns the upper bound of the highest *finite* bucket, which is the
   * largest number the histogram can honestly stand behind — an understatement, and a visible one,
   * because the value pins to a round bound like `5` and stops moving. That flat line at the top
   * of the chart is the histogram saying its buckets are too narrow for what is happening.
   */
  if (index === buckets.length - 1) return buckets[buckets.length - 2].le;

  const upper = buckets[index].le;
  // The lowest bucket starts at zero: a duration is not negative, and prom-client's first bound is
  // the smallest thing it can distinguish rather than the smallest thing it has seen.
  let lower = 0;
  let count = buckets[index].count;
  if (index > 0) {
    lower = buckets[index - 1].le;
    count -= buckets[index - 1].count;
    rank -= buckets[index - 1].count;
  }

  // Every observation in this bucket sits on its own upper bound, as far as anything here knows.
  if (count <= 0) return upper;

  return lower + (upper - lower) * (rank / count);
}

/**
 * Buckets sharing an `le`, added together.
 *
 * They arrive that way whenever the caller has summed a histogram across a label it does not care
 * about — which is precisely what the throughput of a service is, the same latency histogram
 * reported once per route. Summing here rather than asking every caller to is what keeps the
 * grouping in one place.
 */
function coalesce(input: LeBucket[]): LeBucket[] {
  const totals = new Map<number, number>();
  for (const bucket of input) {
    if (!Number.isFinite(bucket.count) || bucket.count < 0) continue;
    if (Number.isNaN(bucket.le)) continue;
    totals.set(bucket.le, (totals.get(bucket.le) ?? 0) + bucket.count);
  }

  return [...totals].map(([le, count]) => ({ le, count })).sort((a, b) => a.le - b.le);
}

/**
 * A cumulative histogram whose counts go *down* as `le` goes up is arithmetically impossible and
 * routinely arrives anyway.
 *
 * Two causes, both benign: floating-point drift in the exporter's own summation, and — the one
 * that matters here — a bucket series scraped a fraction of a second apart from its neighbour, so
 * a request counted in `le=0.5` at 12:00:00.100 is not yet counted in `le=1` read at 12:00:00.099.
 * Left alone, either turns the `findIndex` above into a search over an unsorted array and returns
 * a quantile from the wrong bucket entirely.
 *
 * The repair is Prometheus': carry the running maximum forward. It cannot invent observations —
 * only refuse to lose ones already counted.
 */
function ensureMonotonic(buckets: LeBucket[]): LeBucket[] {
  let running = 0;
  return buckets.map((bucket) => {
    running = Math.max(running, bucket.count);
    return { le: bucket.le, count: running };
  });
}

/**
 * `le` as the exposition format spells it → a number.
 *
 * `+Inf` is the whole point; `Inf` is accepted because the parser upstream already tolerates it,
 * and anything unparseable is `null` so the caller drops the series rather than sorting `NaN` into
 * the middle of the histogram.
 */
export function parseLe(raw: string | null): number | null {
  if (raw === null) return null;
  if (raw === "+Inf" || raw === "Inf") return Number.POSITIVE_INFINITY;
  // `Number("")` is 0 and `Number(" ")` is 0, so an absent label would otherwise become a bucket
  // bound of zero and sort to the front of every histogram.
  if (raw.trim() === "") return null;

  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
