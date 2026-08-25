import { parseEnv } from "@config/env.validation";
import { PrismaService } from "@db/prisma.service";
import { Module } from "@nestjs/common";
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
 * The metrics view (IKN-23) and the host panel (IKN-25) belong in this module when they arrive:
 * they read the same two tables through the same source decision, and a second copy of that
 * decision is a second answer to "which table holds a week ago".
 *
 * `PrismaModule` is global, so the providers simply inject `PrismaService`.
 */
@Module({
  controllers: [ServiceViewController],
  providers: [
    RuntimeService,
    {
      provide: SignalsService,
      useFactory: (prisma: PrismaService) => {
        const env = parseEnv({ ...process.env });
        return new SignalsService(prisma, env.metricRetentionDays);
      },
      inject: [PrismaService],
    },
  ],
  // Exported for the alert engine (IKN-10): two of its rules read the error rate and the p95, and
  // they must be the same numbers the service view shows rather than a second computation of them.
  exports: [SignalsService],
})
export class MetricsModule {}
