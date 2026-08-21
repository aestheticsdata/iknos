import { IngestModule } from "@ingest/ingest.module";
import { Module } from "@nestjs/common";
import { StreamController } from "@stream/stream.controller";
import { HistogramService } from "./histogram.service";
import { LogsController } from "./logs.controller";
import { LogsService } from "./logs.service";
import { SearchController } from "./search.controller";
import { SearchService } from "./search.service";
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
 * The ⌘K palette's `GET /api/search` lives here too (IKN-22): two of its three sources group
 * over `log_entry`, so it shares this module's window parsing and its `LIKE` escaping rather than
 * growing a second copy of either.
 *
 * `PrismaModule` is global, so the services simply inject `PrismaService`.
 */
@Module({
  imports: [IngestModule],
  controllers: [LogsController, ServicesController, SearchController, StreamController],
  providers: [LogsService, HistogramService, TraceService, SearchService],
})
export class LogsModule {}
