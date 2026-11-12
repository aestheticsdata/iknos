import { Public } from "@auth/public.decorator";
import { timingSafeCompare } from "@common/timing-safe";
import { parseEnv } from "@config/env.validation";
import { PrismaService } from "@db/prisma.service";
import {
  Controller,
  Get,
  NotFoundException,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { isSite } from "@traffic/sites";
import { IsOptional, IsString, MaxLength } from "class-validator";
import { SliService } from "./sli.service";
import { toSliQuery } from "./sli-rules";

import type { SliWindow } from "@contracts/sli";
import type { Request } from "express";

export class SliQueryDto {
  @IsOptional() @IsString() @MaxLength(64) service?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsString() pathPrefix?: string;
  @IsOptional() @IsString() excludePathPrefix?: string;
}

const BEARER = /^Bearer (.+)$/;

/**
 * `GET /api/sli` — Zeus's read of a service around a deploy (IKN-88).
 *
 * `@Public()` because Zeus has no Iknos session, and the bearer token stands in for one. Unlike the
 * ingest token, this one is a secret: it never leaves ks-b. nginx refuses the path from outside the
 * box, so the token is the second wall rather than the only one.
 *
 * The errors are distinct on purpose, because Zeus turns each into a different sentence: 503 is
 * "Iknos is not set up for this", 401 a token that disagrees, 404 a service name Zeus has wrong,
 * 422 a service that is not a site and has no access lines to measure.
 */
@Controller("api")
export class SliController {
  private readonly token: string | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sli: SliService,
  ) {
    this.token = parseEnv({ ...process.env }).sliToken;
  }

  @Public()
  @Get("sli")
  async window(@Query() dto: SliQueryDto, @Req() req: Request): Promise<SliWindow> {
    if (!this.token) throw new ServiceUnavailableException("the SLI route is not configured");

    const presented = BEARER.exec(req.headers.authorization ?? "")?.[1] ?? "";
    if (!timingSafeCompare(this.token, presented)) throw new UnauthorizedException();

    const query = toSliQuery(dto);

    const service = await this.prisma.service.findFirst({
      where: { name: query.service, enabled: true },
      select: { logGlob: true, hosts: true },
    });
    if (!service) throw new NotFoundException(`unknown service '${query.service}'`);
    if (!isSite(service)) throw new UnprocessableEntityException(`'${query.service}' has no nginx access log`);

    return this.sli.window(query);
  }
}
