import { PrismaService } from "@db/prisma.service";
import { Prisma } from "@generated/prisma/client";
import { Injectable } from "@nestjs/common";
import { EVENT_NAME } from "../otlp-limits";
import { readRuns } from "./run-reading";
import { eventFromRaw, factFromRaw } from "./span-facts";

import type { RawEventFact, RawFact, RunReading, RunWindow } from "../interfaces/ai-run-types";

/**
 * The one read behind the AI traces screens (IKN-91 … IKN-94): every span of the window, reduced in
 * SQL to the columns and the `officina.*` attributes the summaries need, then read run by run.
 *
 * Why not aggregate in SQL like the IKN-87 list: a run's checks are "the last verdict of each gate
 * node", and a verdict reaches its node through a parent chain of unknown depth — a recursive CTE
 * per run. The volumes make that pointless: a busy Officina app sends a few hundred runs a day, a
 * run is twenty-odd spans, and two weeks of one service is a few thousand rows of short columns.
 * The prompts live in `span_content` and are not read at all: `content_days` on the span says
 * whether a run was traced at the `full` level, `content_until` until when.
 */

/**
 * The hour before the window is read too, so a run that began just before it is seen whole and left
 * out — rather than read from its tail as if it had started inside.
 */
const LEAD_MS = 3_600_000;

@Injectable()
export class AiRunsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every run that started in `[from, to)`, newest first. */
  async readings(window: RunWindow): Promise<RunReading[]> {
    const from = new Date(window.from.getTime() - LEAD_MS);
    const service = window.service === null ? Prisma.empty : Prisma.sql`AND service = ${window.service}`;
    const raw = await this.prisma.$queryRaw<RawFact[]>`
      SELECT trace_id AS traceId,
             service,
             span_id AS spanId,
             parent_span_id AS parentSpanId,
             name,
             CAST(start_us AS SIGNED) AS startUs,
             CAST(duration_us AS SIGNED) AS durationUs,
             status_code AS statusCode,
             gen_ai_model AS model,
             input_tokens AS inputTokens,
             output_tokens AS outputTokens,
             JSON_UNQUOTE(JSON_EXTRACT(attrs, '$."gen_ai.agent.name"')) AS agentName,
             JSON_UNQUOTE(JSON_EXTRACT(attrs, '$."officina.node.id"')) AS nodeId,
             JSON_UNQUOTE(JSON_EXTRACT(attrs, '$."officina.node.kind"')) AS nodeKind,
             JSON_UNQUOTE(JSON_EXTRACT(attrs, '$."officina.attempt"')) AS attempt,
             COALESCE(JSON_UNQUOTE(JSON_EXTRACT(attrs, '$."gen_ai.prompt.version"')),
                      JSON_UNQUOTE(JSON_EXTRACT(attrs, '$."officina.prompt.version"'))) AS promptVersion,
             JSON_UNQUOTE(JSON_EXTRACT(attrs, '$."officina.pipeline.version"')) AS pipelineVersion,
             JSON_UNQUOTE(JSON_EXTRACT(attrs, '$."officina.gate.pass"')) AS gatePass,
             JSON_UNQUOTE(JSON_EXTRACT(attrs, '$."officina.human.decision"')) AS decision,
             JSON_UNQUOTE(JSON_EXTRACT(attrs, '$."officina.run.status"')) AS runStatus,
             COALESCE(JSON_UNQUOTE(JSON_EXTRACT(attrs, '$."officina.first_token_ms"')),
                      JSON_UNQUOTE(JSON_EXTRACT(attrs, '$."gen_ai.response.time_to_first_chunk"')) * 1000) AS firstTokenMs,
             JSON_UNQUOTE(JSON_EXTRACT(attrs, '$."officina.tokens_per_second"')) AS tokensPerSecond,
             JSON_UNQUOTE(JSON_EXTRACT(attrs, '$."officina.loop.target"')) AS loopTarget,
             content_days IS NOT NULL AS hasContent,
             content_until AS contentUntilUs
        FROM span
       WHERE ts >= ${from} AND ts < ${window.to} ${service}`;

    const events = await this.prisma.$queryRaw<RawEventFact[]>`
      SELECT trace_id AS traceId,
             span_id AS spanId,
             CAST(time_us AS SIGNED) AS timeUs,
             name,
             JSON_UNQUOTE(JSON_EXTRACT(attrs, '$."gen_ai.evaluation.name"')) AS evaluation,
             JSON_UNQUOTE(JSON_EXTRACT(attrs, '$."gen_ai.evaluation.score.label"')) AS label,
             JSON_UNQUOTE(JSON_EXTRACT(attrs, '$."officina.gate.rule_index"')) AS ruleIndex,
             JSON_UNQUOTE(JSON_EXTRACT(attrs, '$."officina.human.decision"')) AS decision
        FROM span_event
       WHERE ts >= ${from} AND ts < ${window.to} ${service}
         AND name IN (${EVENT_NAME.evaluation}, ${EVENT_NAME.humanFeedback})`;

    const fromUs = window.from.getTime() * 1000;
    return readRuns(raw.map(factFromRaw), events.map(eventFromRaw)).filter(
      (reading) => reading.summary.startUs >= fromUs,
    );
  }
}
