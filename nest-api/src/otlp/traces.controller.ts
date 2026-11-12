import { parseWindow } from "@logs/log-query";
import { BadRequestException, Controller, Get, Param, Query } from "@nestjs/common";
import { IsOptional, IsString, MaxLength } from "class-validator";
import { parseTraceId, parseTraceLimit } from "./trace-rows";
import { TracesService } from "./traces.service";

import type { TraceDetail, TraceList } from "@contracts/traces";

/** Strings, parsed by hand — the global pipe runs without `transform` (see `LogQueryDto`). */
class TraceQueryDto {
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsString() @MaxLength(64) service?: string;
  @IsOptional() @IsString() limit?: string;
}

/**
 * The read side of OTLP traces (IKN-87), behind the session guard like every read route — no
 * `@Public()` here, and a write token is not a session: nothing on this controller can be reached
 * with one.
 *
 * `from` and `to` are required on both routes, as on every log route, and for the same reason: the
 * range is the partition pruning.
 */
@Controller("api/traces")
export class TracesController {
  constructor(private readonly traces: TracesService) {}

  /** One row per run of one service. The service is required: the view is scoped by the rail. */
  @Get()
  async list(@Query() p: TraceQueryDto): Promise<TraceList> {
    const { from, to } = parseWindow(p);
    const service = p.service?.trim();
    if (!service) throw new BadRequestException("'service' is required");

    const startedAt = performance.now();
    const { traces, truncated } = await this.traces.list({ service, from, to, limit: parseTraceLimit(p.limit) });

    return { traces, truncated, meta: { tookMs: Math.round(performance.now() - startedAt) } };
  }

  /** Every span of one trace. An unknown id is an empty list, not a 404 — the question was well formed. */
  @Get(":traceId")
  async detail(@Param("traceId") rawId: string, @Query() p: TraceQueryDto): Promise<TraceDetail> {
    const traceId = parseTraceId(rawId);
    const { from, to } = parseWindow(p);

    const startedAt = performance.now();
    const { spans, truncated } = await this.traces.spans(traceId, from, to);

    return { traceId, spans, truncated, meta: { tookMs: Math.round(performance.now() - startedAt) } };
  }
}
