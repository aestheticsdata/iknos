import { AuthModule } from "@auth/auth.module";
import { SessionGuard } from "@auth/session.guard";
import { CollectorModule } from "@collector/collector.module";
import { AllExceptionsFilter } from "@common/all-exceptions.filter";
import { httpLoggerOptions, logger } from "@common/logger";
import { validate } from "@config/env.validation";
import { PrismaModule } from "@db/prisma.module";
import { IngestModule } from "@ingest/ingest.module";
import { IssuesModule } from "@issues/issues.module";
import { LogsModule } from "@logs/logs.module";
import { MaintenanceModule } from "@maintenance/maintenance.module";
import { MetricsModule } from "@metrics/metrics.module";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { RedisModule } from "@redis/redis.module";
import { ScrapeModule } from "@src/scrape/scrape.module";
import { LoggerModule } from "nestjs-pino";
import { HealthController } from "./health.controller";

/**
 * One Nest app hosts both the HTTP API and the collector — one PM2 process, one Prisma client,
 * and a live tail served from an in-process event bus rather than by polling MySQL.
 *
 * Auth (IKN-6, IKN-21), the collector (IKN-7), the log routes (IKN-19), the partition window
 * (IKN-11), the collector's own status (IKN-24), the service view's metrics (IKN-13) and grouped
 * errors (IKN-9) are in. Alerts arrive with IKN-10.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Boot fails here, before anything opens a socket, naming every offending variable.
      validate,
      // Development only. On ks-b the values come from PM2's `env_production` and no .env file
      // exists beside the release — a missing file is a normal state here, not a failure.
      envFilePath: ".env",
    }),
    // Nest's own output takes the ECS shape too, so `[NestFactory] Starting…` is ingestible by
    // the same parser as everything else rather than being the one thing that is not.
    LoggerModule.forRoot({
      pinoHttp: {
        logger,
        // Turns the access line into real ECS — method, path, status, duration, client address —
        // and keeps the request object, cookie and all, out of it entirely (IKN-30).
        ...httpLoggerOptions,
        // The collector polls these; logging every hit would drown the file the collector is
        // reading, which is a loop worth avoiding on principle.
        autoLogging: { ignore: (req) => req.url === "/health" },
      },
    }),
    PrismaModule,
    RedisModule,
    AuthModule,
    IngestModule,
    LogsModule,
    MaintenanceModule,
    ScrapeModule,
    MetricsModule,
    CollectorModule,
    IssuesModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_FILTER,
      // Registered globally, never per-controller: a controller added later is covered because
      // it exists, not because someone remembered.
      useValue: new AllExceptionsFilter(logger),
    },
    {
      provide: APP_GUARD,
      // Same reasoning, and here it is the security property itself: every route is denied
      // until something says otherwise, so the only way to expose one is to write `@Public()`.
      useClass: SessionGuard,
    },
  ],
})
export class AppModule {}
