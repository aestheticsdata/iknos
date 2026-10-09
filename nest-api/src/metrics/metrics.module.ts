import { parseEnv } from "@config/env.validation";
import { PrismaService } from "@db/prisma.service";
import { Module } from "@nestjs/common";
import { HostController } from "./host.controller";
import { HostService } from "./host.service";
import { RouteMetricsService } from "./route-metrics.service";
import { RuntimeService } from "./runtime.service";
import { ServiceViewController } from "./service-view.controller";
import { SignalsService } from "./signals.service";

/**
 * Everything the service view reads (IKN-13).
 *
 * `SignalsService` is built by a factory for the same reason `MaintenanceService` is: its second
 * parameter is a plain number out of the validated environment, not an injectable. It is the raw
 * metric retention — the only thing that decides whether a range is answered from `metric_sample`
 * or from `metric_rollup` — and it is read here rather than asked of `MaintenanceService`, whose
 * `window()` reports the *log* retention and would quietly hand back the wrong knob.
 *
 * The metrics view (IKN-23) lives here for that reason — `RouteMetricsService` reads the same two
 * tables through the same source decision. The host panel (IKN-25) lives here too: it reads
 * `host_sample` on the same one-minute grid floor the signals use.
 *
 * `PrismaModule` is global, so the providers simply inject `PrismaService`.
 */
@Module({
  controllers: [ServiceViewController, HostController],
  providers: [
    RuntimeService,
    HostService,
    {
      provide: SignalsService,
      useFactory: (prisma: PrismaService) => {
        const env = parseEnv({ ...process.env });
        return new SignalsService(prisma, env.metricRetentionDays);
      },
      inject: [PrismaService],
    },
    {
      provide: RouteMetricsService,
      useFactory: (prisma: PrismaService) => {
        const env = parseEnv({ ...process.env });
        return new RouteMetricsService(prisma, env.metricRetentionDays, env.scrapeIntervalMs);
      },
      inject: [PrismaService],
    },
  ],
  // Exported for the alert engine (IKN-10): two of its rules read the error rate and the p95, and
  // they must be the same numbers the service view shows rather than a second computation of them.
  exports: [SignalsService],
})
export class MetricsModule {}
