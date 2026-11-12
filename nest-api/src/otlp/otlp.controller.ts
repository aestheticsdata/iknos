import { Public } from "@auth/public.decorator";
import { RateLimitService } from "@auth/ratelimit.service";
import { parseEnv } from "@config/env.validation";
import {
  BadRequestException,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpException,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { OTLP_CONTENT_TYPES, OTLP_TOKEN_HEADER, OTLP_TOKEN_QUERY } from "./otlp-limits";
import { OtlpMalformedError, parseTraces } from "./otlp-parse";
import { SpanWriter } from "./span-writer.service";
import { originAllowed } from "./token";
import { TokenRegistry } from "./token-registry.service";

import type { OtlpExportResponse } from "@contracts/otlp";
import type { Request, Response } from "express";
import type { ParseOutcome } from "./interfaces/otlp-types";

/** Seconds a throttled sender is told to wait — the length of the rate window. */
const RETRY_AFTER_SECONDS = "60";

/** How many distinct rejection reasons are spelled out in `errorMessage`. */
const MAX_REASONS = 5;

/**
 * `POST /api/otlp/v1/traces` — OTLP/HTTP JSON trace export, for the Officina apps' AI pipeline
 * traces (IKN-87).
 *
 * `@Public()`, like `POST /api/ingest`: a page on another domain has no session. What stands in its
 * place, in order, cheapest first:
 *
 * 1. the content type — JSON, or the `text/plain` a beacon is sent as (415 otherwise);
 * 2. a rate limit per client address, before any database read (429);
 * 3. the write token — header for `fetch`, `?token=` for the beacon — resolved by hash to one
 *    enabled service (401);
 * 4. that token's own origin list, when the request has an `Origin` (403);
 * 5. a rate limit per token (429);
 * 6. the body: JSON, OTLP-shaped, within the span ceiling (400); the byte ceiling (413) is the
 *    body reader's, before any of this runs.
 *
 * The token decides the service. `service.name` in the payload is never read, so a token for
 * Opifex cannot file spans as Vidar — or as Iknos.
 */
@Controller("api/otlp/v1")
export class OtlpController {
  private readonly tokenRate: number;
  private readonly ipRate: number;
  private readonly retentionDays: number;

  constructor(
    private readonly registry: TokenRegistry,
    private readonly writer: SpanWriter,
    private readonly rateLimit: RateLimitService,
  ) {
    const config = parseEnv({ ...process.env });
    this.tokenRate = config.otlpTokenRatePerMinute;
    this.ipRate = config.otlpIpRatePerMinute;
    this.retentionDays = config.retentionDays;
  }

  @Public()
  @Post("traces")
  // 200, not 202: OTLP/HTTP defines success as 200 with an `ExportTraceServiceResponse` body, and
  // exporters read anything else as a failure to retry.
  @HttpCode(200)
  async traces(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<OtlpExportResponse> {
    const mediaType = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (!(OTLP_CONTENT_TYPES as readonly string[]).includes(mediaType)) {
      // Protobuf is the other OTLP/HTTP encoding; this endpoint speaks JSON only, and says so.
      throw new UnsupportedMediaTypeException("OTLP/HTTP JSON only: application/json or text/plain");
    }

    if (!(await this.rateLimit.allowOtlpIp(req.ip ?? "unknown", this.ipRate))) this.throttled(res);

    const grant = await this.registry.resolve(presentedToken(req));
    if (grant === null) throw new UnauthorizedException();

    if (!originAllowed(req.headers.origin, grant.origins)) {
      throw new ForbiddenException("origin not allowed for this token");
    }

    if (!(await this.rateLimit.allowOtlpToken(grant.id, this.tokenRate))) this.throttled(res);

    const outcome = this.parse(req.body, grant.service);
    await this.writer.write(outcome.spans);
    this.registry.touch(grant.id);

    return toResponse(outcome);
  }

  /** 429 with the window's length, which OTLP exporters honour before retrying. */
  private throttled(res: Response): never {
    res.setHeader("Retry-After", RETRY_AFTER_SECONDS);
    throw new HttpException("Too many requests", 429);
  }

  /** The text the body reader kept, as JSON, as OTLP. Every failure here is the sender's: a 400. */
  private parse(body: unknown, service: string): ParseOutcome {
    if (typeof body !== "string" || body.trim() === "") throw new BadRequestException("empty body");

    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      throw new BadRequestException("the body is not valid JSON");
    }

    try {
      return parseTraces(json, { service, now: new Date(), maxAgeDays: this.retentionDays });
    } catch (error) {
      if (error instanceof OtlpMalformedError) throw new BadRequestException(error.message);
      throw error;
    }
  }
}

/** The header first; the query parameter is the beacon's fallback. Anything but one string is none. */
function presentedToken(req: Request): string {
  const header = req.headers[OTLP_TOKEN_HEADER];
  if (typeof header === "string" && header !== "") return header;

  const query = req.query[OTLP_TOKEN_QUERY];
  return typeof query === "string" ? query : "";
}

function toResponse(outcome: ParseOutcome): OtlpExportResponse {
  if (outcome.rejected === 0) return { partialSuccess: {} };
  return {
    partialSuccess: {
      rejectedSpans: outcome.rejected,
      errorMessage: outcome.reasons.slice(0, MAX_REASONS).join("; "),
    },
  };
}
