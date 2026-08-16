import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { LoggerModule } from "nestjs-pino";
import { SessionGuard } from "./auth/session.guard";
import { AllExceptionsFilter } from "./common/all-exceptions.filter";
import { logger } from "./common/logger";
import { validate } from "./config/env.validation";
import { HealthController } from "./health.controller";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./redis/redis.module";

/**
 * One Nest app hosts both the HTTP API and the collector — one PM2 process, one Prisma client,
 * and a live tail served from an in-process event bus rather than by polling MySQL.
 *
 * The rest arrives with its task: auth (Tasks 8–11), ingest (Tasks 12–16), logs (Tasks 17–19).
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
        // The collector polls these; logging every hit would drown the file the collector is
        // reading, which is a loop worth avoiding on principle.
        autoLogging: { ignore: (req) => req.url === "/health" },
      },
    }),
    PrismaModule,
    RedisModule,
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
