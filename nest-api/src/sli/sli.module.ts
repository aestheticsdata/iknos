import { IngestModule } from "@ingest/ingest.module";
import { Module } from "@nestjs/common";
import { SliController } from "./sli.controller";
import { SliService } from "./sli.service";

/**
 * Request indicators per service for Zeus's post-deploy verification (IKN-88).
 *
 * Imports `IngestModule` for one reading only: how far the collector has stored, which is what lets
 * the answer tell a quiet site from a stalled collector.
 */
@Module({
  imports: [IngestModule],
  controllers: [SliController],
  providers: [SliService],
})
export class SliModule {}
