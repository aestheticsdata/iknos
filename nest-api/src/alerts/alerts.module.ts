import { PrismaService } from "@db/prisma.service";
import { MetricsModule } from "@metrics/metrics.module";
import { SignalsService } from "@metrics/signals.service";
import { Module } from "@nestjs/common";
import { AlertEngine } from "./alert-engine.service";
import { NoopSink } from "./alert-sink";
import { AlertsController } from "./alerts.controller";
import { AlertsService } from "./alerts.service";

/**
 * The alert engine (IKN-10) and the routes that serve what it writes (IKN-15).
 *
 * `MetricsModule` is imported for one thing: `SignalsService`, which already computes the error
 * rate and the p95 over a range — counter resets, missed scrapes and restart intervals included.
 * Two of the six rules read it, and a rule running its own `SUM` over `metric_sample` would be a
 * second answer to a question that already has one.
 *
 * The engine is built by a factory because two of its parameters are not injectables: the sink,
 * which ships as a no-op, and the rule list, which the specs replace with a single rule to drive
 * one predicate at a time. Same reason `SignalsService` and `MaintenanceService` are factories.
 *
 * As in `IssuesModule`, the writer and the readers share a module because they share a subject,
 * not a dependency: one fills the tables on an interval, the other reads them on request.
 */
@Module({
  imports: [MetricsModule],
  controllers: [AlertsController],
  providers: [
    AlertsService,
    {
      provide: AlertEngine,
      useFactory: (prisma: PrismaService, signals: SignalsService) => new AlertEngine(prisma, signals, new NoopSink()),
      inject: [PrismaService, SignalsService],
    },
  ],
  exports: [AlertEngine, AlertsService],
})
export class AlertsModule {}
