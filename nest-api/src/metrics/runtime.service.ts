import { PrismaService } from "@db/prisma.service";
import { HEALTH_WINDOW_MS } from "@logs/service-rail";
import { Injectable } from "@nestjs/common";
import { RUNTIME_METRICS, RUNTIME_WINDOW_MS, toNodeRuntime, toProbeSummary, toProcessFacts } from "./runtime-facts";

import type { ServiceRuntime } from "@contracts/service-runtime";

/**
 * What the service view's header, its health pills and its runtime tile read (IKN-13).
 *
 * Four small bounded reads, and every one of them carries a lower bound on `ts` — not for tidiness
 * but because all three tables are partitioned by day: an `ORDER BY ts DESC LIMIT 1` without one
 * walks every partition ever retained to find a row that is almost always in today's.
 */

/** The registry row this reads about — passed in rather than re-fetched, since the caller has it. */
export type ServiceRegistration = {
  name: string;
  pm2Name: string;
  metricsUrl: string | null;
  healthUrl: string | null;
};

export type RuntimeResult = Omit<ServiceRuntime, "meta">;

@Injectable()
export class RuntimeService {
  constructor(private readonly prisma: PrismaService) {}

  async runtime(service: ServiceRegistration, now: Date = new Date()): Promise<RuntimeResult> {
    const probeSince = new Date(now.getTime() - HEALTH_WINDOW_MS);
    const gaugeSince = new Date(now.getTime() - RUNTIME_WINDOW_MS);

    const [process, probe, release, gauges] = await Promise.all([
      this.prisma.processSample.findFirst({
        where: { pm2Name: service.pm2Name, ts: { gte: probeSince } },
        orderBy: { ts: "desc" },
        select: { ts: true, pm2Id: true, status: true, restarts: true, nodeVersion: true, startedAt: true },
      }),
      this.prisma.healthCheck.findFirst({
        where: { service: service.name, ts: { gte: probeSince } },
        orderBy: { ts: "desc" },
        select: { ts: true, httpStatus: true, ok: true, latencyMs: true, error: true, checks: true },
      }),
      /*
       * The last release the service *reported*, which is not necessarily the last probe.
       *
       * A failed probe has no body to read a version out of, so taking it from the newest row would
       * blank the chip for exactly as long as the service is down — the one time somebody wants to
       * know which release is on the box. The newest row that carried one is the honest answer, and
       * `checkedAt` on the probe beside it says how current the rest of the picture is.
       */
      this.prisma.healthCheck.findFirst({
        where: { service: service.name, ts: { gte: probeSince }, version: { not: null } },
        orderBy: { ts: "desc" },
        select: { version: true },
      }),
      this.prisma.metricSample.findMany({
        where: { service: service.name, name: { in: [...RUNTIME_METRICS] }, ts: { gte: gaugeSince } },
        select: { ts: true, name: true, labelsHash: true, labels: true, value: true },
      }),
    ]);

    return {
      service: service.name,
      pm2Name: service.pm2Name,
      scraped: service.metricsUrl !== null,
      probed: service.healthUrl !== null,
      release: release?.version ?? null,
      process: process ? toProcessFacts(process) : null,
      probe: probe ? toProbeSummary(probe, now) : null,
      // `null` only when nothing scrapes this service at all. A scraped service with no readings
      // gets an object full of nulls, which is a different sentence: the tile says "no reading in
      // the last few minutes" rather than "this service exposes nothing".
      runtime: service.metricsUrl === null ? null : toNodeRuntime(gauges),
      observedAt: now.toISOString(),
    };
  }
}
