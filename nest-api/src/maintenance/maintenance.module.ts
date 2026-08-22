import { parseEnv } from "@config/env.validation";
import { PrismaService } from "@db/prisma.service";
import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { MaintenanceService } from "./maintenance.service";

/**
 * The sliding partition window and retention (IKN-11).
 *
 * `ScheduleModule.forRoot()` lives here rather than in `AppModule` because this is the only thing
 * in the process that owns a cron. When metrics rollups arrive (IKN-20) they belong beside it, in
 * this module, for the same reason the collector and the API share one process: one scheduler,
 * one place to look when something did not run.
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
      provide: MaintenanceService,
      useFactory: (prisma: PrismaService) => {
        const env = parseEnv({ ...process.env });
        return new MaintenanceService(env.retentionDays, prisma, undefined, env.metricRetentionDays);
      },
      inject: [PrismaService],
    },
  ],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
