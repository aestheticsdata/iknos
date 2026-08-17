import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { parseEnv } from "../config/env.validation";
import { PrismaService } from "../prisma/prisma.service";
import { LogBus } from "../stream/log-bus";
import { HttpIngestController } from "./http-ingest.controller";
import { HttpIngestService } from "./http-ingest.service";
import { IngestService } from "./ingest.service";

/**
 * The two ways a log line gets in, and the bus they both publish to.
 *
 * `IngestService` tails PM2's files — everything with a stdout. `HttpIngestController` accepts
 * posted events, which exists for the browser and nothing else: a page has no stdout, so a
 * JavaScript error has no other route to ks-b.
 *
 * Both mounted inside the API process — one PM2 entry, one Prisma pool, and a live tail that
 * never polls the database (see `LogBus`).
 *
 * `IngestService` is built by a factory rather than by class injection because its first
 * parameter is a plain string: the PM2 log glob out of the validated environment, read the same
 * way `main.ts` reads the port. Everything else about it is ordinary DI.
 */
@Module({
  // For `RateLimitService`. The ingestion route is `@Public()`, so a ceiling is the only thing
  // between it and a page stuck in a render loop.
  imports: [AuthModule],
  controllers: [HttpIngestController],
  providers: [
    LogBus,
    HttpIngestService,
    {
      provide: IngestService,
      useFactory: (bus: LogBus, prisma: PrismaService) =>
        new IngestService(parseEnv({ ...process.env }).pm2LogGlob, bus, prisma),
      inject: [LogBus, PrismaService],
    },
  ],
  exports: [LogBus, IngestService],
})
export class IngestModule {}
