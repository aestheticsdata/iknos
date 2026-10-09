import { parseEnv } from "@config/env.validation";
import { PrismaService } from "@db/prisma.service";
import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { MaintenanceService } from "./maintenance.service";
import { RollupService } from "./rollup.service";

/**
 * The sliding partition window and retention (IKN-11).
 *
 * `ScheduleModule.forRoot()` lives here rather than in `AppModule` because this is the only thing
 * in the process that owns a cron. The hourly metric rollups (IKN-20) live beside it for the same
 * reason the collector and the API share one process — one scheduler, one place to look when
 * something did not run — and because the purge must ask them before it drops a raw day.
 *
 * `MaintenanceService` is built by a factory for the same reason `IngestService` is — its first
 * parameter is a plain number out of the validated environment, not an injectable.
 *
 * Exported for IKN-24, which serves `window()` over HTTP.
 */
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [
    {
      provide: RollupService,
      useFactory: (prisma: PrismaService) =>
        new RollupService(prisma, parseEnv({ ...process.env }).metricRetentionDays),
      inject: [PrismaService],
    },
    {
      provide: MaintenanceService,
      useFactory: (prisma: PrismaService, rollups: RollupService) => {
        const env = parseEnv({ ...process.env });
        return new MaintenanceService(prisma, {
          retentionDays: env.retentionDays,
          metricRetentionDays: env.metricRetentionDays,
          rollupRetentionDays: env.rollupRetentionDays,
          rollups,
        });
      },
      inject: [PrismaService, RollupService],
    },
  ],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
