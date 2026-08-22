import { PrismaService } from "@db/prisma.service";
import { Module } from "@nestjs/common";
import { defaultScrapeIo, ScrapeService } from "./scrape.service";

/**
 * The metrics half of the collector (IKN-8): scraping `/metrics`, probing `/health`, sampling
 * the machine and the PM2 process list — everything the log tailer does not see.
 *
 * Built by a factory for the same reason `IngestService` is: the IO bag is plain functions, not
 * providers, and handing it in whole is what lets the specs run the cycles without a socket,
 * a /proc or a pm2 binary.
 */
@Module({
  providers: [
    {
      provide: ScrapeService,
      useFactory: (prisma: PrismaService) => new ScrapeService(prisma, defaultScrapeIo()),
      inject: [PrismaService],
    },
  ],
  exports: [ScrapeService],
})
export class ScrapeModule {}
