import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpException,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ArrayMaxSize, IsArray, IsString, MaxLength, MinLength } from "class-validator";
import { Public } from "../auth/public.decorator";
import { RateLimitService } from "../auth/ratelimit.service";
import { timingSafeCompare } from "../common/timing-safe";
import { parseEnv } from "../config/env.validation";
import { HttpIngestService, MAX_EVENTS_PER_REQUEST } from "./http-ingest.service";

import type { Request } from "express";
import type { IngestResult } from "./http-ingest.service";

/** Named like Sentry's, and public for the same reason: it identifies a sender, it hides nothing. */
export const INGEST_TOKEN_HEADER = "x-iknos-token";

class IngestDto {
  /** Must already exist in the `service` table — see `isKnownService`. */
  @IsString()
  @MinLength(1, { message: "service must not be empty" })
  @MaxLength(64, { message: "service must be at most 64 characters" })
  service!: string;

  /**
   * ECS objects, exactly as the app would have printed them to stdout.
   *
   * Typed `unknown[]` on purpose: validating their shape here would be a second, divergent
   * definition of what a log line is. The parser already decides, and it degrades rather than
   * rejects — which is the behaviour a monitoring tool wants from anything it is handed.
   */
  @IsArray({ message: "events must be an array" })
  @ArrayMaxSize(MAX_EVENTS_PER_REQUEST, {
    message: `events must contain at most ${MAX_EVENTS_PER_REQUEST} entries`,
  })
  events!: unknown[];
}

/**
 * `POST /api/ingest` — the browser's only way in.
 *
 * `@Public()`, because a page on another domain has no Iknos session and never will. What stands
 * in its place is four cheap checks, and the token is the weakest of them by design: it travels
 * in a JavaScript bundle, so it identifies rather than authenticates. The registry lookup, the
 * origin allowlist and the rate limit are what actually hold.
 */
@Controller("api")
export class HttpIngestController {
  private readonly token: string | null;
  private readonly origins: string[];

  constructor(
    private readonly ingest: HttpIngestService,
    private readonly rateLimit: RateLimitService,
  ) {
    // Read once at construction, like `main.ts` reads the port. The validated config is the only
    // thing in the process allowed to touch `process.env`.
    const config = parseEnv({ ...process.env });
    this.token = config.ingestToken;
    this.origins = config.ingestOrigins;
  }

  @Public()
  @Post("ingest")
  // 202: the events are committed before this returns, but the caller is a fire-and-forget
  // beacon — "accepted" describes the exchange better than "created", and there is no resource
  // to point it at.
  @HttpCode(202)
  async post(@Body() body: IngestDto, @Req() req: Request): Promise<IngestResult> {
    if (!this.token) {
      // Closed until deliberately configured, and it says so rather than answering 401 to a
      // correct token — an operator debugging this deserves to know which of the two is wrong.
      throw new ServiceUnavailableException("ingestion is not configured");
    }

    const presented = req.headers[INGEST_TOKEN_HEADER];
    if (!timingSafeCompare(this.token, typeof presented === "string" ? presented : "")) {
      throw new UnauthorizedException();
    }

    // Only ever checked when the caller sent one. A server-to-server sender — curl, a pino
    // transport — has no `Origin` at all, and demanding one would lock out every non-browser.
    const origin = req.headers.origin;
    if (typeof origin === "string" && this.origins.length > 0 && !this.origins.includes(origin)) {
      throw new ForbiddenException("origin not allowed");
    }

    const ip = req.ip ?? "unknown";
    if (!(await this.rateLimit.allowIngest(ip))) {
      throw new HttpException("Too many requests", 429);
    }

    if (!(await this.ingest.isKnownService(body.service))) {
      // Deliberately distinguishable from a bad token: this is a configuration mistake on the
      // sender's side, and "add the row" is the fix.
      throw new BadRequestException(`unknown or disabled service '${body.service}'`);
    }

    return this.ingest.ingest(body.service, body.events);
  }
}
