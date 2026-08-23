import { PrismaService } from "@db/prisma.service";
import { parseWindow } from "@logs/log-query";
import { Controller, Get, NotFoundException, Param, Query } from "@nestjs/common";
import { IsOptional, IsString } from "class-validator";
import { RuntimeService } from "./runtime.service";
import { SignalsService } from "./signals.service";

import type { ServiceRuntime } from "@contracts/service-runtime";
import type { ServiceSignals } from "@contracts/service-signals";

/**
 * The two routes the service view reads (IKN-13). Both behind the global session guard, like
 * everything that is not `/health` — there is no `@Public()` in this file, and the absence is the
 * security property: a route is denied until something says otherwise.
 *
 * They are split because they age on different clocks. `runtime` is a snapshot of the process and
 * has nothing to do with the range selector; `signals` is three `GROUP BY`s over whatever window
 * the top bar is showing. Serving both from one route would either re-run the aggregates every
 * time the pills refreshed, or leave the pills as stale as the widest chart on screen.
 */

/**
 * The window, and nothing else.
 *
 * Declared as strings and converted by hand for the same reason `LogQueryDto` is: the global
 * `ValidationPipe` runs without `transform`, so a `@Type(() => Number)` here would be silently
 * inert and the field would be a string while typed otherwise. `parseWindow` is imported rather
 * than re-implemented — one definition of "both bounds are required", shared with the log routes,
 * because both tables are partitioned by day and the reason is the same on both.
 */
export class SignalsQueryDto {
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}

@Controller("api/services/:service")
export class ServiceViewController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runtimeService: RuntimeService,
    private readonly signalsService: SignalsService,
  ) {}

  /** The header chips, the health pills and the runtime gauges — the facts that are true now. */
  @Get("runtime")
  async runtime(@Param("service") name: string): Promise<ServiceRuntime> {
    const startedAt = performance.now();
    const service = await this.registration(name);

    const runtime = await this.runtimeService.runtime(service);

    return { ...runtime, meta: { tookMs: Math.round(performance.now() - startedAt) } };
  }

  /** Throughput, error rate and p95 over the requested range. */
  @Get("signals")
  async signals(@Param("service") name: string, @Query() query: SignalsQueryDto): Promise<ServiceSignals> {
    const { from, to } = parseWindow(query);
    const startedAt = performance.now();
    const service = await this.registration(name);

    /*
     * A service nobody scrapes is answered without touching `metric_sample` at all.
     *
     * Most of the registry is in that state — one row on this box carries a `metricsUrl` — and
     * running three aggregate queries per view to confirm that a table has no rows for a service
     * that was never going to be in it is work paid on every page load for an answer known from
     * the registry row.
     */
    if (service.metricsUrl === null) {
      return {
        service: service.name,
        scraped: false,
        ...emptySignals(from, to),
        meta: { tookMs: Math.round(performance.now() - startedAt) },
      };
    }

    const signals = await this.signalsService.signals(service.name, from, to);

    return {
      service: service.name,
      scraped: true,
      ...signals,
      meta: { tookMs: Math.round(performance.now() - startedAt) },
    };
  }

  /**
   * The registry row, or a 404.
   *
   * A name that is not in the registry is not a service with no data — it is not a service. The
   * rail can only offer names that came from `/api/services`, so reaching this is a hand-written
   * URL or a service disabled since the page was loaded, and both deserve to be told rather than
   * shown an empty view that looks like an outage.
   */
  private async registration(name: string) {
    const service = await this.prisma.service.findFirst({
      where: { name, enabled: true },
      select: { name: true, pm2Name: true, metricsUrl: true, healthUrl: true },
    });
    if (!service) throw new NotFoundException(`unknown service '${name}'`);

    return service;
  }
}

/**
 * The shape an unscraped service answers with: the window echoed back, no points, no source.
 *
 * `points: []` rather than a run of nulls, deliberately. A null point means "this interval was not
 * observed", which invites the reader to wonder when it will be; an empty series means there is no
 * series, which is the permanent truth about a service that exposes no `/metrics` — and it is what
 * lets the tile draw its own sentence instead of an axis with nothing on it.
 */
function emptySignals(from: Date, to: Date): Omit<ServiceSignals, "service" | "scraped" | "meta"> {
  const empty = { value: null, points: [] };

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    bucketMs: 0,
    source: "none",
    throughput: empty,
    errorRate: empty,
    p95: empty,
  };
}
