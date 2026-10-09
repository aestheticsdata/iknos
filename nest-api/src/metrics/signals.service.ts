import { PrismaService } from "@db/prisma.service";
import { Injectable } from "@nestjs/common";
import { readSamples } from "./metric-samples";
import { planSource } from "./metric-window";
import { buildSignals, METRIC_NAMES } from "./signal-series";

import type { ServiceSignals } from "@contracts/service-signals";

/**
 * The queries behind the service view's first three tiles (IKN-13).
 *
 * Everything that decides what a number *means* lives in `signal-series.ts`, `counter-rate.ts` and
 * `histogram-quantile.ts`, which are pure and tested against worked examples. The scans themselves
 * live in `metric-samples.ts` since the metrics view (IKN-23) started reading the same rows — two
 * range scans, cut on a bucket boundary, both returning the last reading of every series in every
 * interval.
 */

/* Re-exported from where they now live: the alert engine and this module's spec name them here. */
export { SIGNALS_MAX_EXECUTION_MS, SIGNALS_TOO_SLOW } from "./metric-samples";

export type SignalsResult = Omit<ServiceSignals, "service" | "scraped" | "meta">;

@Injectable()
export class SignalsService {
  constructor(
    private readonly prisma: PrismaService,
    /** `IKNOS_METRIC_RETENTION_DAYS` — how far back raw samples can be relied on. */
    private readonly rawWindowDays: number,
  ) {}

  async signals(service: string, from: Date, to: Date, now: Date = new Date()): Promise<SignalsResult> {
    const plan = planSource(from, to, now, this.rawWindowDays);
    const rows = await readSamples(this.prisma, { service, from, to, plan, names: METRIC_NAMES });

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      bucketMs: plan.bucketMs,
      source: plan.source,
      ...buildSignals(rows, from, plan),
    };
  }
}
