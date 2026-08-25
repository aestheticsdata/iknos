import { ERROR_RATE_PCT, LATENCY_P95_MS, METRIC_FOR_MS } from "../thresholds";

import type { Observation, Rule, RuleContext } from "../rule";

/**
 * The two rules that read `metric_sample`, through `SignalsService` (IKN-10).
 *
 * **Nothing is recomputed here.** `SignalsService.signals(service, from, to)` already returns the
 * error rate and the p95 over a range, and everything hard about them — counter resets, missed
 * scrapes, restart intervals excluded from a rate, the histogram quantile — is settled inside it
 * and tested against worked examples. A rule that ran its own `SUM` over `metric_sample` would be
 * a second answer to a question that already has one.
 *
 * Both share one call per service per pass, memoised by `RuleContext.signals`.
 *
 * **They cover two services.** Nineteen are enabled on ks-b and two carry a `metricsUrl`
 * (`pfa-nest-api`, `worldweathr-api`) — checked against the live registry, not assumed. The rules
 * iterate `hasMetrics` targets rather than the registry, because a loop over all nineteen is a
 * partition scan per cycle for seventeen services that have never written a sample.
 *
 * **Units are the trap.** `errorRate.value` is a percent on 0–100, so the constant is `5` and not
 * `0.05`; `p95.value` is milliseconds, so it is `1000` and not `1`. Both may be `null`, and null
 * is *no scrape* — never "below threshold", never zero.
 */

const scrapedOnly = async (
  ctx: RuleContext,
  read: (signals: NonNullable<Awaited<ReturnType<RuleContext["signals"]>>>) => number | null,
  over: number,
): Promise<Observation[]> => {
  const targets = ctx.targets.filter((target) => target.hasMetrics);

  return Promise.all(
    targets.map(async (target): Promise<Observation> => {
      const signals = await ctx.signals(target.name);
      const value = signals === null ? null : read(signals);

      // `null` is not a breach and, downstream, not a resolution either — an open alert with no
      // reading is left exactly as it was. That is what stops a scrape outage from silently
      // closing every alert on the box.
      return { service: target.name, value, breached: value !== null && value > over };
    }),
  );
};

export const errorRate: Rule = {
  key: "error_rate",
  severity: "warning",
  title: "5xx rate above threshold",
  expr: `rate(http_5xx[10m]) > ${ERROR_RATE_PCT}%`,
  forMs: METRIC_FOR_MS,
  threshold: ERROR_RATE_PCT,
  unit: "percent",
  evaluate: (ctx) => scrapedOnly(ctx, (signals) => signals.errorRate.value, ERROR_RATE_PCT),
};

export const latencyP95: Rule = {
  key: "latency_p95",
  severity: "warning",
  title: "p95 latency above threshold",
  expr: `p95(http_duration[10m]) > ${LATENCY_P95_MS}ms`,
  forMs: METRIC_FOR_MS,
  threshold: LATENCY_P95_MS,
  unit: "ms",
  evaluate: (ctx) => scrapedOnly(ctx, (signals) => signals.p95.value, LATENCY_P95_MS),
};
