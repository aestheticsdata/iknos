import { parseWindow } from "@logs/log-query";
import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { IsInt, IsISO8601, IsOptional, IsString, MaxLength, Min, MinLength } from "class-validator";
import { AiRunsService } from "./runs/ai-runs.service";
import { matchesFilters, runFacets, runKpis } from "./runs/run-list";
import { DAY_US, qualityReport } from "./runs/run-quality";
import {
  parseOffset,
  parseOptionalService,
  parseRequiredService,
  parseRunFilters,
  parseStep,
  QUALITY_SERIES_DAYS,
} from "./runs/run-query";
import { readRun } from "./runs/run-reading";
import { versionReport } from "./runs/run-versions";
import { eventsFromRow, factFromRow } from "./runs/span-facts";
import { GateTicketsService } from "./tickets/gate-tickets.service";
import { parseTraceId, parseTraceLimit } from "./trace-rows";
import { TracesService } from "./traces.service";

import type { AiRunList, FailureTicket, QualityReport, VersionReport } from "@contracts/ai-runs";
import type { TraceDetail } from "@contracts/traces";

/** Strings, parsed by hand — the global pipe runs without `transform` (see `LogQueryDto`). */
class TraceQueryDto {
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsString() @MaxLength(64) service?: string;
  @IsOptional() @IsString() limit?: string;
  @IsOptional() @IsString() offset?: string;
  @IsOptional() @IsString() @MaxLength(16) checks?: string;
  @IsOptional() @IsString() @MaxLength(16) review?: string;
  @IsOptional() @IsString() @MaxLength(255) prompt?: string;
  @IsOptional() @IsString() @MaxLength(255) model?: string;
  @IsOptional() @IsString() @MaxLength(128) step?: string;
}

/** `POST /api/traces/quality/tickets` — validated by the global pipe; numbers arrive as JSON numbers. */
class CreateTicketDto {
  @IsString() @MinLength(1) @MaxLength(64) service!: string;
  @IsString() @MinLength(1) @MaxLength(128) gate!: string;
  @IsString() @MinLength(1) @MaxLength(255) gateLabel!: string;
  @IsOptional() @IsString() @MaxLength(128) step!: string | null;
  @IsInt() @Min(0) failures!: number;
  @IsOptional() @IsInt() @Min(0) previous!: number | null;
  @IsISO8601() from!: string;
  @IsISO8601() to!: string;
}

const elapsed = (startedAt: number): number => Math.round(performance.now() - startedAt);

/**
 * The read side of OTLP traces (IKN-87), and the AI traces screens built on it (IKN-91 … IKN-94),
 * behind the session guard like every read route — no `@Public()` here, and a write token is not a
 * session: nothing on this controller can be reached with one.
 *
 * `from` and `to` are required on every route, as on every log route, and for the same reason: the
 * range is the partition pruning. The static routes are declared before `:traceId`.
 */
@Controller("api/traces")
export class TracesController {
  constructor(
    private readonly traces: TracesService,
    private readonly runs: AiRunsService,
    private readonly tickets: GateTicketsService,
  ) {}

  /** The run list: one row per run, newest first, filtered and paged, with the window's headline numbers. */
  @Get()
  async list(@Query() p: TraceQueryDto): Promise<AiRunList> {
    const { from, to } = parseWindow(p);
    const filters = parseRunFilters(p);
    const limit = parseTraceLimit(p.limit);
    const offset = parseOffset(p.offset);

    const startedAt = performance.now();
    const readings = await this.runs.readings({ service: parseOptionalService(p.service), from, to });
    const kept = readings.map((reading) => reading.summary).filter((run) => matchesFilters(run, filters));

    return {
      runs: kept.slice(offset, offset + limit),
      total: kept.length,
      kpis: runKpis(kept),
      facets: runFacets(readings),
      meta: { tookMs: elapsed(startedAt) },
    };
  }

  /** One service's quality over the window, against the window before it, with a daily series. */
  @Get("quality")
  async quality(@Query() p: TraceQueryDto): Promise<QualityReport> {
    const { from, to } = parseWindow(p);
    const service = parseRequiredService(p.service);
    const spanMs = to.getTime() - from.getTime();
    const dataFrom = new Date(Math.min(from.getTime() - spanMs, to.getTime() - (QUALITY_SERIES_DAYS * DAY_US) / 1000));

    const startedAt = performance.now();
    const readings = await this.runs.readings({ service, from: dataFrom, to });
    const body = qualityReport(readings, {
      fromUs: from.getTime() * 1000,
      toUs: to.getTime() * 1000,
      seriesDays: QUALITY_SERIES_DAYS,
    });
    const [failures, ticketing] = await Promise.all([
      this.tickets.attach(service, body.failures),
      this.tickets.ticketing(service),
    ]);
    return { service, ...body, failures, ticketing, meta: { tookMs: elapsed(startedAt) } };
  }

  /**
   * Files a failure pattern as a Spira ticket in the service's project (IKN-96), or returns the
   * one it already has. 503 when Spira is not configured or the service has no project.
   */
  @Post("quality/tickets")
  createTicket(@Body() body: CreateTicketDto): Promise<FailureTicket> {
    return this.tickets.create({ ...body, step: body.step ?? null, previous: body.previous ?? null });
  }

  /** One service's step — or whole pipeline — compared across the prompt versions and models it ran with. */
  @Get("versions")
  async versions(@Query() p: TraceQueryDto): Promise<VersionReport> {
    const { from, to } = parseWindow(p);
    const service = parseRequiredService(p.service);
    const step = parseStep(p.step);

    const startedAt = performance.now();
    const readings = await this.runs.readings({ service, from, to });
    return { service, step, ...versionReport(readings, step), meta: { tookMs: elapsed(startedAt) } };
  }

  /** Every span of one trace, and the run read from them. An unknown id is an empty list, not a 404. */
  @Get(":traceId")
  async detail(@Param("traceId") rawId: string, @Query() p: TraceQueryDto): Promise<TraceDetail> {
    const traceId = parseTraceId(rawId);
    const { from, to } = parseWindow(p);

    const startedAt = performance.now();
    const { spans, truncated } = await this.traces.spans(traceId, from, to);
    const summary =
      spans.length > 0
        ? readRun(
            spans.map((row) => factFromRow(traceId, row)),
            spans.flatMap((row) => eventsFromRow(traceId, row)),
          ).summary
        : null;

    return { traceId, summary, spans, truncated, meta: { tookMs: elapsed(startedAt) } };
  }
}
