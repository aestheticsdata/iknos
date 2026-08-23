import { describe, expect, it } from "vitest";
import {
  buildSignals,
  DURATION_BUCKET,
  elapsedOf,
  type MetricRow,
  PROCESS_START,
  REQUESTS_TOTAL,
  restartIntervals,
} from "./signal-series";

import type { SourcePlan } from "./metric-window";

/**
 * Rows → the three tiles (IKN-13).
 *
 * The cases worth having are the ones where a wrong answer looks entirely reasonable: an error rate
 * of `0 %` over an interval nobody called, a throughput averaged over hours the collector slept
 * through, and a headline p95 taken as the mean of sixty per-interval p95s.
 */

const FROM = new Date("2026-08-23T12:00:00.000Z");
const MINUTE = 60_000;

const PLAN: SourcePlan = { bucketMs: MINUTE, buckets: 3, boundary: 0, source: "raw" };
/** The same grid with a single interval, for the cases that need only one. */
const ONE: SourcePlan = { ...PLAN, buckets: 1 };

/**
 * One reading, taken half-way through its interval — which is where a regular scrape lands, and
 * what makes the measured distance between two consecutive readings exactly one interval.
 */
const row = (name: string, series: string, labels: unknown, bucket: number, value: number): MetricRow => ({
  bucket,
  ts: FROM.getTime() + bucket * MINUTE + MINUTE / 2,
  name,
  series,
  labels,
  value,
});

/** One scrape reading per interval, priming interval included — the collector doing its job. */
const scraped = (buckets: number[]): MetricRow[] =>
  buckets.map((bucket) => row(PROCESS_START, "proc", null, bucket, 1_787_481_637));

/** A counter's readings across the intervals, oldest first, starting at the priming interval. */
const counter = (name: string, series: string, labels: unknown, values: number[]): MetricRow[] =>
  values.map((value, index) => row(name, series, labels, index - 1, value));

describe("buildSignals", () => {
  /*
   * One minute-by-minute scenario used by most of the cases below.
   *
   *   requests 200 : 100 → 110 → 120 → 130     (10 per interval)
   *   requests 500 :   0 →   0 →   2 →   2     (a pair of failures in the second interval)
   *   latency ≤0.1s: 100 → 105 → 110 → 115
   *   latency +Inf : 100 → 110 → 122 → 130
   */
  const rows: MetricRow[] = [
    ...scraped([-1, 0, 1, 2]),
    ...counter(REQUESTS_TOTAL, "ok", { status_code: "200" }, [100, 110, 120, 130]),
    ...counter(REQUESTS_TOTAL, "bad", { status_code: "500" }, [0, 0, 2, 2]),
    ...counter(DURATION_BUCKET, "fast", { le: "0.1" }, [100, 105, 110, 115]),
    ...counter(DURATION_BUCKET, "all", { le: "+Inf" }, [100, 110, 122, 130]),
  ];

  it("lays every series on the requested grid, one point per interval", () => {
    const { throughput } = buildSignals(rows, FROM, PLAN);

    expect(throughput.points.map((point) => point.t)).toEqual([
      "2026-08-23T12:00:00.000Z",
      "2026-08-23T12:01:00.000Z",
      "2026-08-23T12:02:00.000Z",
    ]);
  });

  it("reports throughput as requests per second over each interval", () => {
    const { throughput } = buildSignals(rows, FROM, PLAN);

    // 10, 12 and 10 requests in a minute each.
    expect(throughput.points.map((point) => point.v)).toEqual([10 / 60, 12 / 60, 10 / 60]);
    // The headline is the whole window: 32 requests over three minutes.
    expect(throughput.value).toBeCloseTo(32 / 180, 10);
  });

  it("counts 5xx against every response, and nothing else", () => {
    const { errorRate } = buildSignals(rows, FROM, PLAN);

    expect(errorRate.points.map((point) => point.v)).toEqual([0, (2 / 12) * 100, 0]);
    expect(errorRate.value).toBeCloseTo((2 / 32) * 100, 10);
  });

  it("leaves 4xx out of the error rate", () => {
    // A mistyped password is a 401 and an expired export is a 404: both are the application
    // working. A tile that goes amber for them is a tile nobody reads by the end of the week.
    const withClientErrors: MetricRow[] = [
      ...scraped([-1, 0]),
      ...counter(REQUESTS_TOTAL, "ok", { status_code: "200" }, [0, 8]),
      ...counter(REQUESTS_TOTAL, "denied", { status_code: "401" }, [0, 2]),
    ];

    const { errorRate } = buildSignals(withClientErrors, FROM, ONE);

    expect(errorRate.points[0].v).toBe(0);
    expect(errorRate.value).toBe(0);
  });

  it("interpolates the p95 from the histogram buckets", () => {
    const { p95 } = buildSignals(rows, FROM, PLAN);

    // Interval 0: 5 requests under 100ms out of 10 · the rank of 9.5 falls in `+Inf`, so the
    // answer is the highest finite bound — 0.1s — reported in milliseconds.
    expect(p95.points.map((point) => point.v)).toEqual([100, 100, 100]);
    expect(p95.value).toBe(100);
  });

  it("takes the headline p95 from the whole window, not from the mean of the intervals", () => {
    // Two quiet intervals of one fast request each, then a busy interval of ninety-eight slow ones.
    // Averaging the three per-interval p95s gives 642ms — the two quiet minutes weigh as much as
    // the minute that went wrong. The window's own p95 is 974ms, because that is where the 95th of
    // the hundred requests actually falls.
    const spike: MetricRow[] = [
      ...scraped([-1, 0, 1, 2]),
      ...counter(DURATION_BUCKET, "fast", { le: "0.5" }, [0, 1, 2, 2]),
      ...counter(DURATION_BUCKET, "mid", { le: "1" }, [0, 1, 2, 100]),
      ...counter(DURATION_BUCKET, "all", { le: "+Inf" }, [0, 1, 2, 100]),
    ];

    const { p95 } = buildSignals(spike, FROM, PLAN);

    expect(p95.points.map((point) => point.v)).toEqual([475, 475, 975]);
    const meanOfPoints = (475 + 475 + 975) / 3;
    expect(p95.value).toBeCloseTo(974.49, 2);
    expect(p95.value).toBeGreaterThan(meanOfPoints);
  });

  it("draws a hole where nothing was scraped, and spreads the traffic that spanned it", () => {
    /*
     * Interval 1 was never observed, so a bar of zero there would report an outage as a quiet
     * minute. Interval 2 is the subtler half: the counter kept counting through the gap, so its
     * increment is *two* minutes of requests — and against a one-minute divisor that is a spike at
     * exactly the moment the collector stopped watching. Divided by the two minutes it actually
     * measured, it is the truth: twenty requests, ten a minute, over the stretch that was seen.
     */
    // Interval 1 has no rows at all, heartbeat or counter — a scrape writes every series together,
    // so a missed scrape is missing from all of them.
    const withGap: MetricRow[] = [
      ...scraped([-1, 0, 2]),
      ...[-1, 0].map((bucket, i) => row(REQUESTS_TOTAL, "ok", { status_code: "200" }, bucket, 100 + i * 10)),
      row(REQUESTS_TOTAL, "ok", { status_code: "200" }, 2, 130),
    ];

    const { throughput, errorRate, p95 } = buildSignals(withGap, FROM, PLAN);

    expect(throughput.points.map((point) => point.v)).toEqual([10 / 60, null, 20 / 120]);
    expect(errorRate.points[1].v).toBeNull();
    expect(p95.points[1].v).toBeNull();
    // Thirty requests over the three minutes that were measured.
    expect(throughput.value).toBeCloseTo(30 / 180, 10);
  });

  it("measures a stumble in the collection rather than turning it into a dip and a spike", () => {
    /*
     * The failure a nominal divisor produces, and the reason there is not one.
     *
     * The collector loses the tail of interval 1, so its last reading is half a minute early and
     * the next interval's covers ninety seconds instead of sixty. Against a fixed 60 s divisor that
     * is a matched pair — interval 1 reads low and interval 2 reads high — at exactly the moment
     * the collection faltered. Measured, both are the ten-a-minute the service was really serving.
     */
    const rows: MetricRow[] = [
      ...scraped([-1, 0]),
      { ...row(PROCESS_START, "proc", null, 1, 1_787_481_637), ts: FROM.getTime() + MINUTE },
      ...scraped([2]),
      ...counter(REQUESTS_TOTAL, "ok", { status_code: "200" }, [100, 110, 115, 130]),
    ];

    const { throughput } = buildSignals(rows, FROM, PLAN);

    // Interval 1 saw 5 requests in 30 s, interval 2 saw 15 in 90 s — both a sixth of a request a
    // second, which is what the service was doing throughout.
    expect(throughput.points.map((point) => point.v)).toEqual([10 / 60, 10 / 60, 10 / 60]);
  });

  it("differences across the rollup/raw seam as though it were one series", () => {
    /*
     * The junction, which is the whole of what "no hole" has to mean for a counter.
     *
     * Intervals 0 and 1 come out of `metric_rollup` and intervals 2 and 3 out of `metric_sample`;
     * the rows arrive here indistinguishable, keyed on the same `labels_hash`, so the difference
     * taken at interval 2 is against interval 1's rollup value rather than starting from nothing.
     * A seam that started a new series would leave interval 2 empty.
     */
    const plan: SourcePlan = { bucketMs: MINUTE, buckets: 4, boundary: 2, source: "mixed" };
    const rows: MetricRow[] = [
      ...scraped([-1, 0, 1, 2, 3]),
      ...counter(REQUESTS_TOTAL, "ok", { status_code: "200" }, [100, 110, 120, 130, 140]),
    ];

    const { throughput } = buildSignals(rows, FROM, plan);

    expect(throughput.points.map((point) => point.v)).toEqual([10 / 60, 10 / 60, 10 / 60, 10 / 60]);
  });

  it("has nothing to quote for the first interval when the range starts unprimed", () => {
    // No reading before `from`: the first counter value is a total since the process started, not
    // an increment, and `0 req/s` on that bar would be a confident answer to a question nothing was
    // asked about.
    const unprimed: MetricRow[] = [
      ...scraped([0, 1, 2]),
      ...counter(REQUESTS_TOTAL, "ok", { status_code: "200" }, [100, 110, 120, 130]),
    ];

    const { throughput } = buildSignals(unprimed, FROM, PLAN);

    expect(throughput.points[0].v).toBeNull();
    expect(throughput.points[1].v).toBe(10 / 60);
  });

  it("says nothing at all for the interval a restart happened in", () => {
    /*
     * `process_start_time_seconds` changes in interval 1, and the two counters below disagree about
     * which process they are describing: `/a` was called again after the restart and reports a small
     * new total, `/b` was not and is still carrying its whole pre-restart lifetime — a Prometheus
     * client publishes a labelled child only once it has been touched.
     *
     * Crediting the drop would inject `/b`'s entire history as one minute of traffic; crediting the
     * difference would report `/a` as having served nothing. Neither is true, so the interval is
     * refused — and interval 2 is correct on the ordinary drop rule.
     */
    const restarted: MetricRow[] = [
      ...[-1, 0].map((bucket) => row(PROCESS_START, "proc", null, bucket, 1_787_000_000)),
      ...[1, 2].map((bucket) => row(PROCESS_START, "proc", null, bucket, 1_787_400_000)),
      ...[-1, 0].map((bucket) => row(REQUESTS_TOTAL, "a", { status_code: "200" }, bucket, 1_000)),
      row(REQUESTS_TOTAL, "a", { status_code: "200" }, 1, 12),
      row(REQUESTS_TOTAL, "a", { status_code: "200" }, 2, 24),
      // Quiet since before the restart, and still reporting the total it had then.
      ...[-1, 0, 1].map((bucket) => row(REQUESTS_TOTAL, "b", { status_code: "200" }, bucket, 9_000)),
      row(REQUESTS_TOTAL, "b", { status_code: "200" }, 2, 5),
    ];

    const { throughput } = buildSignals(restarted, FROM, PLAN);

    expect(throughput.points[1].v).toBeNull();
    // Interval 2: twelve more from `/a`, and `/b`'s five are a reset the drop rule sees on its own.
    expect(throughput.points[2].v).toBeCloseTo(17 / 60, 10);
    // And the refused interval is out of the headline too: seventeen requests over the two minutes
    // that could be quoted — interval 0, in which nothing moved, and interval 2.
    expect(throughput.value).toBeCloseTo(17 / 120, 10);
  });

  it("has no error rate for an interval with no requests at all", () => {
    // A rate with an empty denominator is undefined, not zero: nothing failed and nothing
    // succeeded, and `0 %` there is a claim about a sample size of none.
    const idle: MetricRow[] = [
      ...scraped([-1, 0]),
      ...counter(REQUESTS_TOTAL, "ok", { status_code: "200" }, [500, 500]),
    ];

    const { throughput, errorRate } = buildSignals(idle, FROM, ONE);

    // Throughput is genuinely zero — the interval was watched and nothing arrived.
    expect(throughput.points[0].v).toBe(0);
    expect(errorRate.points[0].v).toBeNull();
    expect(errorRate.value).toBeNull();
  });

  it("says nothing at all about a range with no rows", () => {
    const { throughput, errorRate, p95 } = buildSignals([], FROM, PLAN);

    expect(throughput.points.map((point) => point.v)).toEqual([null, null, null]);
    expect(throughput.value).toBeNull();
    expect(errorRate.value).toBeNull();
    expect(p95.value).toBeNull();
  });

  it("reads labels whether the driver parsed them or handed back their text", () => {
    const asText: MetricRow[] = [
      ...scraped([-1, 0]),
      ...counter(REQUESTS_TOTAL, "ok", '{"status_code":"200"}', [0, 8]),
      ...counter(REQUESTS_TOTAL, "bad", '{"status_code":"503"}', [0, 2]),
    ];

    const { errorRate } = buildSignals(asText, FROM, ONE);

    expect(errorRate.points[0].v).toBe(20);
  });
});

describe("restartIntervals", () => {
  it("names the interval the heartbeat changed value in", () => {
    const heartbeat = [
      row(PROCESS_START, "proc", null, -1, 1_787_000_000),
      row(PROCESS_START, "proc", null, 0, 1_787_000_000),
      row(PROCESS_START, "proc", null, 1, 1_787_400_000),
      row(PROCESS_START, "proc", null, 2, 1_787_400_000),
    ];

    expect([...restartIntervals(heartbeat)]).toEqual([1]);
  });

  it("names nothing for a process that never went away", () => {
    const heartbeat = [-1, 0, 1].map((bucket) => row(PROCESS_START, "proc", null, bucket, 1_787_000_000));

    expect(restartIntervals(heartbeat).size).toBe(0);
  });
});

describe("elapsedOf", () => {
  it("measures the distance between the readings a difference was actually taken from", () => {
    expect(elapsedOf(scraped([-1, 0, 1, 2]), 3)).toEqual([MINUTE, MINUTE, MINUTE]);
  });

  it("spans a whole interval the collector was away for, rather than pretending it was one", () => {
    // Interval 1 has no reading and cannot be quoted; interval 2's increment covers two minutes,
    // and saying so is what stops it being drawn as two minutes of traffic in one.
    expect(elapsedOf(scraped([-1, 0, 2]), 3)).toEqual([MINUTE, null, 2 * MINUTE]);
  });

  it("has nothing to measure for the first interval when nothing precedes the range", () => {
    expect(elapsedOf(scraped([0, 1]), 2)).toEqual([null, MINUTE]);
  });
});
