import { PrismaService } from "@db/prisma.service";
import { LogsModule } from "@logs/logs.module";
import { Module } from "@nestjs/common";
import { EVENTS_PER_MINUTE, GrouperService } from "./grouper.service";
import { IssuesController } from "./issues.controller";
import { IssuesService } from "./issues.service";

/**
 * Grouped errors (IKN-9), and the routes that serve them (IKN-14).
 *
 * `PrismaModule` is global, so the provider simply injects `PrismaService`. Nothing is imported
 * from `IngestModule` and nothing subscribes to `LogBus`: the grouper reads committed rows on its
 * own interval rather than riding the ingest path, which is what lets it rejoin a multi-line
 * stack that only exists as several rows — and what keeps a failure here out of the collector.
 *
 * Built by a factory for the same reason `MaintenanceService` and `IngestService` are: its second
 * parameter is a plain number, not an injectable, and Nest would try to resolve `Number`.
 *
 * The routes take nothing from the grouper and the grouper takes nothing from them: one writes
 * the tables on an interval, the other reads them on request. They share a module because they
 * share a subject, not a dependency.
 *
 * `ScheduleModule` is not needed. This owns a latched `setInterval`, the shape `ScrapeService`
 * and `IngestService` use — the cron in `MaintenanceModule` is for work that must happen at a
 * wall-clock time, and this is work that must happen often.
 */
@Module({
  // For `LogsService` alone, which `GET /api/issues/for-log/:id` reads the target line through —
  // the one place these two subjects touch, and it reads through the log module's own service
  // rather than writing a second bounded point read of `log_entry`.
  imports: [LogsModule],
  controllers: [IssuesController],
  providers: [
    IssuesService,
    {
      provide: GrouperService,
      useFactory: (prisma: PrismaService) => new GrouperService(prisma, EVENTS_PER_MINUTE),
      inject: [PrismaService],
    },
  ],
  exports: [GrouperService, IssuesService],
})
export class IssuesModule {}
