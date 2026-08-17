import { Module } from "@nestjs/common";
import { parseEnv } from "../config/env.validation";
import { PrismaService } from "../prisma/prisma.service";
import { LogBus } from "../stream/log-bus";
import { IngestService } from "./ingest.service";

/**
 * The collector, mounted inside the API process — one PM2 entry, one Prisma pool, and a live
 * tail that never polls the database (see `LogBus`).
 *
 * `IngestService` is built by a factory rather than by class injection because its first
 * parameter is a plain string: the PM2 log glob out of the validated environment, read the same
 * way `main.ts` reads the port. Everything else about it is ordinary DI.
 */
@Module({
  providers: [
    LogBus,
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
