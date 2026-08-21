import { IngestModule } from "@ingest/ingest.module";
import { MaintenanceModule } from "@maintenance/maintenance.module";
import { Module } from "@nestjs/common";
import { CollectorController } from "./collector.controller";
import { StorageService } from "./storage.service";

/**
 * The two routes that describe Iknos rather than what Iknos collects (IKN-24).
 *
 * It owns no state of its own: the counters live on the collector and the retention window lives
 * on the maintenance job, and this module exists to expose them over HTTP without either of those
 * growing a controller. `IngestModule` and `MaintenanceModule` already export exactly what it
 * reads, which is why neither needed changing to be observable.
 */
@Module({
  imports: [IngestModule, MaintenanceModule],
  controllers: [CollectorController],
  providers: [StorageService],
})
export class CollectorModule {}
