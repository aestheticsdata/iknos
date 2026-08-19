import { IngestModule } from "@ingest/ingest.module";
import { Module } from "@nestjs/common";
import { StreamController } from "@stream/stream.controller";
import { HistogramService } from "./histogram.service";
import { LogsController } from "./logs.controller";
import { LogsService } from "./logs.service";
import { ServicesController } from "./services.controller";
import { TraceService } from "./trace.service";

/**
 * Everything the Logs view reads.
 *
 * `IngestModule` is imported for one thing: `LogBus`, which the live tail subscribes to. That is
 * the whole reason the collector and the API share a process — the stream serves rows from the
 * memory of the thing that just wrote them, instead of asking MySQL every second whether anything
 * new has appeared.
 *
 * `PrismaModule` is global, so the services simply inject `PrismaService`.
 */
@Module({
  imports: [IngestModule],
  controllers: [LogsController, ServicesController, StreamController],
  providers: [LogsService, HistogramService, TraceService],
})
export class LogsModule {}
