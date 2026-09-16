import { AuthModule } from "@auth/auth.module";
import { parseEnv } from "@config/env.validation";
import { PrismaService } from "@db/prisma.service";
import { Module } from "@nestjs/common";
import { LogBus } from "@stream/log-bus";
import { HttpIngestController } from "./http-ingest.controller";
import { HttpIngestService } from "./http-ingest.service";
import { IngestService } from "./ingest.service";
import { NginxSource } from "./nginx-source";
import { Pm2Source } from "./pm2-source";

/**
 * The two ways a log line gets in, and the bus they both publish to.
 *
 * `IngestService` drives the tailer over its sources: PM2's files, which is everything with a
 * stdout, and since IKN-16 the nginx access logs the registry names, which is what nginx answered
 * without ever proxying. `HttpIngestController` accepts posted events, which exists for the
 * browser and nothing else: a page has no stdout, so a JavaScript error has no other route to
 * ks-b.
 *
 * Both mounted inside the API process — one PM2 entry, one Prisma pool, and a live tail that
 * never polls the database (see `LogBus`).
 *
 * `IngestService` is built by a factory rather than by class injection because it takes a list of
 * sources: the PM2 glob comes out of the validated environment, the way `main.ts` reads the port,
 * and the nginx source needs the Prisma client to find its files at all. Everything else about it
 * is ordinary DI.
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
        new IngestService(
          // PM2 first, so on a tick where the database is unreachable the source that does not
          // need it has already run.
          [new Pm2Source(parseEnv({ ...process.env }).pm2LogGlob), new NginxSource(prisma)],
          bus,
          prisma,
        ),
      inject: [LogBus, PrismaService],
    },
  ],
  exports: [LogBus, IngestService],
})
export class IngestModule {}
