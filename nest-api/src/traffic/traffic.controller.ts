import { PrismaService } from "@db/prisma.service";
import { parseWindow } from "@logs/log-query";
import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  UnprocessableEntityException,
} from "@nestjs/common";
import { IsOptional, IsString, MaxLength } from "class-validator";
import { safeTimeZone } from "./buckets";
import { TrafficService } from "./traffic.service";

import type { SiteTraffic, TrafficOverview } from "@contracts/traffic";
import type { TrafficQuery } from "./interfaces/traffic-types";

/**
 * The window, and the zone the reader counts days in.
 *
 * Strings, converted by hand, for the reason `SignalsQueryDto` gives: the global pipe runs without
 * `transform`. `tz` is an IANA name; anything `Intl` refuses falls back to Paris rather than
 * failing the page over a browser's odd setting.
 */
export class TrafficQueryDto {
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsString() @MaxLength(64) tz?: string;
}

/** Both behind the global session guard — nothing here is `@Public()`. */
@Controller("api")
export class TrafficController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly traffic: TrafficService,
  ) {}

  /** Every site, one card each — the view with `all` selected in the rail. */
  @Get("traffic")
  async overview(@Query() query: TrafficQueryDto): Promise<TrafficOverview> {
    const window = toQuery(query);
    const startedAt = performance.now();

    const overview = await this.traffic.overview(window);

    return { ...overview, meta: { tookMs: Math.round(performance.now() - startedAt) } };
  }

  /**
   * One site's dashboard. 404 for a name the registry does not have (or has paused), 422 for a
   * service that exists but writes no access log — a PM2 app, which has no traffic to read.
   */
  @Get("services/:service/traffic")
  async site(@Param("service") name: string, @Query() query: TrafficQueryDto): Promise<SiteTraffic> {
    const window = toQuery(query);
    const startedAt = performance.now();

    const service = await this.prisma.service.findFirst({
      where: { name, enabled: true },
      select: { name: true, logGlob: true },
    });
    if (!service) throw new NotFoundException(`unknown service '${name}'`);
    if (service.logGlob === null) throw new UnprocessableEntityException(`'${name}' has no nginx access log`);

    const traffic = await this.traffic.site(service.name, window);

    return { ...traffic, meta: { tookMs: Math.round(performance.now() - startedAt) } };
  }
}

/**
 * The longest range the view asks for is fourteen days. A month is room to spare; past it the
 * bucket grid and the pass would spend real CPU on a URL nobody's screen produces.
 */
export const MAX_TRAFFIC_SPAN_DAYS = 31;

const toQuery = (query: TrafficQueryDto): TrafficQuery => {
  const { from, to } = parseWindow(query);
  if (+to - +from > MAX_TRAFFIC_SPAN_DAYS * 86_400_000) {
    throw new BadRequestException(`the range must be at most ${MAX_TRAFFIC_SPAN_DAYS} days`);
  }
  return { from, to, tz: safeTimeZone(query.tz), now: new Date() };
};
