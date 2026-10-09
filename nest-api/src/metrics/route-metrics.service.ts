import { LATENCY_P95_MS } from "@alerts/thresholds";
import { PrismaService } from "@db/prisma.service";
import { Injectable, NotFoundException } from "@nestjs/common";
import { readSamples } from "./metric-samples";
import { planSource } from "./metric-window";
import { buildRouteDetail, buildRouteRows } from "./route-series";
import { DURATION_BUCKET, PROCESS_START, REQUESTS_TOTAL } from "./signal-series";

import type { RouteDetail, RouteKey, RouteList } from "@contracts/route-metrics";
import type { TimeWindow } from "./metric-samples";

/**
 * The reads behind the metrics view (IKN-23).
 *
 * The same scans as the service tiles (`metric-samples.ts`), the same source decision
 * (`planSource`), and the same three metrics. What differs is only how the rows are grouped, which
 * is `route-series.ts`'s job and is tested there.
 */

/** The HTTP metrics a route is made of. The heartbeat comes along as the clock. */
const ROUTE_METRICS = [REQUESTS_TOTAL, DURATION_BUCKET] as const;
const NAMES = [...ROUTE_METRICS, PROCESS_START] as const;

export type RouteListResult = Omit<RouteList, "service" | "scraped" | "meta">;
export type RouteDetailResult = Omit<RouteDetail, "service" | "meta">;

@Injectable()
export class RouteMetricsService {
  constructor(
    private readonly prisma: PrismaService,
    /** `IKNOS_METRIC_RETENTION_DAYS` — see `SignalsService`, which is handed the same number. */
    private readonly rawWindowDays: number,
    /** `IKNOS_SCRAPE_INTERVAL_SECONDS`, in ms — quoted by the detail's provenance line (IKN-63). */
    private readonly scrapeIntervalMs: number,
  ) {}

  async routes(service: string, from: Date, to: Date): Promise<RouteListResult> {
    const plan = planSource(from, to, new Date(), this.rawWindowDays);
    const rows = await readSamples(this.prisma, { service, from, to, plan, names: NAMES });

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      source: plan.source,
      p95ThresholdMs: LATENCY_P95_MS,
      routes: buildRouteRows(rows, plan),
    };
  }

  /**
   * One route, narrowed in SQL before the sort that makes these scans expensive (IKN-66).
   *
   * A route with no series in the range is a 404 rather than an empty detail: the table only
   * offers routes it has rows for, so reaching this is a range that slid past the route's last
   * scrape, and saying so beats a panel of em dashes that looks like a broken chart.
   */
  async detail(service: string, window: TimeWindow, target: RouteKey) {
    const { from, to } = window;
    const plan = planSource(from, to, new Date(), this.rawWindowDays);
    const rows = await readSamples(this.prisma, {
      service,
      from,
      to,
      plan,
      names: NAMES,
      series: { ...target, labelled: ROUTE_METRICS },
    });

    const detail = buildRouteDetail({ rows, from, plan, target });
    if (detail === null) {
      throw new NotFoundException(`no samples for ${target.method} ${target.route} in this range`);
    }

    const result: RouteDetailResult = {
      from: from.toISOString(),
      to: to.toISOString(),
      bucketMs: plan.bucketMs,
      source: plan.source,
      p95ThresholdMs: LATENCY_P95_MS,
      scrapeIntervalMs: this.scrapeIntervalMs,
      ...detail,
    };
    return result;
  }
}
