import { AuthModule } from "@auth/auth.module";
import { Module } from "@nestjs/common";
import { OtlpController } from "./otlp.controller";
import { AiRunsService } from "./runs/ai-runs.service";
import { TestSetsController } from "./sets/test-sets.controller";
import { TestSetsService } from "./sets/test-sets.service";
import { SpanWriter } from "./span-writer.service";
import { GateTicketsService } from "./tickets/gate-tickets.service";
import { TokenRegistry } from "./token-registry.service";
import { TracesController } from "./traces.controller";
import { TracesService } from "./traces.service";

/**
 * OTLP trace ingestion and the Traces view's reads (IKN-87).
 *
 * The third way data gets in, beside the collector and `POST /api/ingest`, and deliberately not
 * folded into either: spans are not log lines — they have parents, durations and a tree — and
 * forcing them through the ECS parser would lose exactly the structure they exist to carry.
 *
 * `TokenRegistry` is exported for `main.ts`, whose CORS middleware asks it which origins exist.
 */
@Module({
  // For `RateLimitService`; `PrismaModule` and `RedisModule` are global.
  imports: [AuthModule],
  controllers: [OtlpController, TracesController, TestSetsController],
  providers: [TokenRegistry, SpanWriter, TracesService, AiRunsService, GateTicketsService, TestSetsService],
  exports: [TokenRegistry],
})
export class OtlpModule {}
