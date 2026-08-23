import { chooseBucketMs } from "@logs/histogram.service";

import type { MetricSource } from "@contracts/service-signals";

/**
 * Where the answer to a range comes from, and on what grid (IKN-13).
 *
 * **The caller asks for a range, not for a source.** Raw samples are kept for
 * `IKNOS_METRIC_RETENTION_DAYS` — three days by default, because raw metrics run to well over a
 * million rows a day per scraped service — and the time range selector goes out to a week. So a
 * `7d` chart already reaches back past the raw window today, and something has to answer for the
 * four days on the left. That something is `metric_rollup` (IKN-20), and choosing between the two
 * is this module's whole job.
 *
 * The rule that makes the join safe is that the two sources are cut on a **bucket boundary** and
 * never overlap: the rollups answer buckets `[0, boundary)` and the raw table answers
 * `[boundary, n)`. Nothing is served twice, nothing is missed, and — because both halves are fed
 * into the same counter walk keyed on `labels_hash` — the first raw bucket is differenced against
 * the last rollup bucket rather than starting from nothing. That is what "no hole at the junction"
 * has to mean for a counter: not merely two lines that meet, but one difference taken across the
 * seam.
 *
 * ⚠️ `metric_rollup` is **empty until IKN-20 ships**. The plan below is correct today and the
 * `mixed` branch is exercised today — a `7d` range takes it — but the rollup half of that range
 * currently has no rows, so those buckets come back `null` and the chart draws a gap rather than
 * an invention. That is the honest rendering of "nothing has been aggregated yet", and it stops
 * being a gap the day the rollup job runs, with no change to this file.
 */

/** The rollup table's own granularity. Nothing finer can be reconstructed from it. */
export const ROLLUP_MS = 3_600_000;

/**
 * The narrowest interval a scraped metric may be bucketed into.
 *
 * The log histogram happily goes down to one second, because a log line either landed in an
 * interval or it did not. A metric is a *sample*, taken every fifteen seconds and never exactly on
 * time — the four readings on this box sit at `:25.024`, `:39.983`, `:54.983`, `:09.979` — so a
 * fifteen-second bucket holds one reading, or two, or none, from jitter alone. Every one of those
 * empty buckets would be indistinguishable from a collector that had stopped, and half the chart
 * would be holes.
 *
 * A minute holds four scrapes. Below that the grid is measuring the scrape's punctuality rather
 * than the service's traffic, and above it a missing bucket means four consecutive misses — which
 * is a genuine gap and is exactly what the chart should show as one.
 */
export const MIN_METRIC_BUCKET_MS = 60_000;

export type SourcePlan = {
  /** The interval width every bucket index below is measured in. */
  bucketMs: number;
  /** How many intervals cover `[from, to)`. */
  buckets: number;
  /**
   * The first interval the raw table answers. `0` means raw answers everything; `buckets` means
   * the rollups do.
   */
  boundary: number;
  source: MetricSource;
};

/**
 * The grid, the cut, and the name for what came out.
 *
 * `now` is a parameter rather than a `new Date()` inside so that the tests can put the retention
 * cliff wherever they need it — the interesting cases are all about where `from` falls relative to
 * a boundary that is otherwise three days behind whenever the suite happens to run.
 */
export function planSource(from: Date, to: Date, now: Date, rawWindowDays: number): SourcePlan {
  const fromMs = +from;
  const toMs = +to;

  /*
   * The oldest instant raw samples can still be relied on.
   *
   * Deliberately derived from the retention setting rather than from a `MIN(ts)` probe of the
   * table: the partition drop happens at three in the morning, so for most of the day the table
   * still holds a few hours it is about to lose, and a plan built on what happens to be there
   * would answer differently at 02:59 and at 03:01 for the same question. The policy is the
   * contract; the rows are its current approximation.
   */
  const rawStartMs = +now - rawWindowDays * 86_400_000;
  const touchesRollup = fromMs < rawStartMs;

  /*
   * The same round steps the log histogram uses (IKN-19) — one definition of what a readable axis
   * is — floored at a minute because these are samples rather than events, and widened to a whole
   * number of hours the moment any part of the answer is an hourly aggregate. Asking a rollup for
   * five-minute intervals would put one full bar beside eleven empty ones and call it a chart.
   */
  const natural = Math.max(chooseBucketMs(fromMs, toMs), MIN_METRIC_BUCKET_MS);
  const bucketMs = touchesRollup ? Math.ceil(Math.max(natural, ROLLUP_MS) / ROLLUP_MS) * ROLLUP_MS : natural;

  const buckets = Math.max(1, Math.ceil((toMs - fromMs) / bucketMs));

  // Rounded *up*, so the boundary bucket — the one the cliff falls inside — is served by the
  // rollups. A bucket straddling the cliff has raw rows for only part of itself, and half an
  // interval reported as a whole one is a dip in the chart at exactly the point a reader would
  // otherwise be told to distrust.
  const boundary = touchesRollup ? Math.min(buckets, Math.max(0, Math.ceil((rawStartMs - fromMs) / bucketMs))) : 0;

  return { bucketMs, buckets, boundary, source: sourceOf(boundary, buckets) };
}

function sourceOf(boundary: number, buckets: number): MetricSource {
  if (boundary <= 0) return "raw";
  if (boundary >= buckets) return "rollup";
  return "mixed";
}

/** The instant bucket `index` starts at. `-1` is the priming interval before the range. */
export function gridStart(from: Date, bucketMs: number, index: number): Date {
  return new Date(+from + index * bucketMs);
}

/**
 * The two half-open windows to query, either of which may be `null`.
 *
 * The priming interval is attached to whichever source covers the *start* of the range, and the
 * raw window begins exactly where the rollup window ends. Overlapping them by one bucket to prime
 * the raw side separately would put two readings of the same series in the same interval, and the
 * counter walk would difference them against each other — a spurious increment at the seam, on
 * every chart wide enough to have one.
 */
export function windowsFor(
  from: Date,
  to: Date,
  plan: SourcePlan,
): {
  rollup: { from: Date; to: Date } | null;
  raw: { from: Date; to: Date } | null;
} {
  const primed = gridStart(from, plan.bucketMs, -1);

  if (plan.boundary <= 0) return { rollup: null, raw: { from: primed, to } };
  if (plan.boundary >= plan.buckets) return { rollup: { from: primed, to }, raw: null };

  const cut = gridStart(from, plan.bucketMs, plan.boundary);
  return { rollup: { from: primed, to: cut }, raw: { from: cut, to } };
}
