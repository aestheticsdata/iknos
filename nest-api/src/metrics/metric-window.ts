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
 * `metric_rollup` is filled hourly by `RollupService` (IKN-20), one row per series per hour stamped
 * with the hour's last reading — the same kind of row as a raw one, which is why the seam needs no
 * special case. Hours from before the job first ran have no rollup and still come back `null`: a
 * gap in the chart rather than an invention.
 */

/** The rollup table's own granularity. Nothing finer can be reconstructed from it. */
export const ROLLUP_MS = 3_600_000;

/**
 * The narrowest interval a scraped metric may be bucketed into.
 *
 * The log histogram happily goes down to one second, because a log line either landed in an
 * interval or it did not. A metric is a *sample*, taken every `IKNOS_SCRAPE_INTERVAL_SECONDS` and
 * never exactly on time — at fifteen seconds the four readings on this box sat at `:25.024`,
 * `:39.983`, `:54.983`, `:09.979` — so a bucket as wide as the cadence holds one reading, or two,
 * or none, from jitter alone. Every one of those empty buckets would be indistinguishable from a
 * collector that had stopped, and half the chart would be holes.
 *
 * At the default thirty seconds (IKN-63) a minute holds two scrapes, so only a missed one can
 * empty it — which is a genuine gap and is exactly what the chart should show as one. The env knob
 * stops at sixty for this reason: one reading per minute is back to jitter deciding the holes.
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

/** What a plan is computed from. */
export type PlanInput = {
  from: Date;
  to: Date;
  now: Date;
  /** `IKNOS_METRIC_RETENTION_DAYS`: where the raw table stops being reliable. */
  rawWindowDays: number;
  /**
   * The end of the service's newest rolled-up hour, or `null` when nothing is rolled up — see
   * `rolledThrough` in `metric-samples.ts`. Optional so a caller that cannot know it gets the
   * cliff-only plan, which is correct and merely slower.
   */
  rolledThrough?: Date | null;
};

/**
 * The grid, the cut, and the name for what came out.
 *
 * `now` is a parameter rather than a `new Date()` inside so that the tests can put the retention
 * cliff wherever they need it — the interesting cases are all about where `from` falls relative to
 * a boundary that is otherwise three days behind whenever the suite happens to run.
 */
export function planSource(input: PlanInput): SourcePlan {
  const { now, rawWindowDays, rolledThrough = null } = input;
  const fromMs = +input.from;
  const toMs = +input.to;

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
  const cliff = touchesRollup ? Math.min(buckets, Math.max(0, Math.ceil((rawStartMs - fromMs) / bucketMs))) : 0;

  /*
   * And on an hourly grid, the rollups answer every bucket they have finished — not only the ones
   * past the cliff (IKN-20).
   *
   * A bucket an hour wide or wider is drawn from the last reading of each series inside it, and the
   * rollup row of a clock hour *is* that reading, stamped where it was taken. So the two tables give
   * the same chart, and the rollup gives it from one row per series per hour instead of a hundred:
   * a `7d` range went from three raw days (over the 8 s ceiling) to the hour or two not yet rolled
   * up. Rounded *down*, the opposite of the cliff: a bucket the rollups have only half of is whole
   * in the raw table, so it is read there.
   */
  const rolled =
    rolledThrough !== null && bucketMs % ROLLUP_MS === 0
      ? Math.min(buckets, Math.max(0, Math.floor((+rolledThrough - fromMs) / bucketMs)))
      : 0;
  const boundary = Math.max(cliff, rolled);

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
