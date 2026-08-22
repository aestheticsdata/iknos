import { PrismaService } from "@db/prisma.service";
import { Prisma } from "@generated/prisma/client";
import { Controller, Get } from "@nestjs/common";
import { latestHealthByService, SPARKLINE_SLOTS, sparklinesByService } from "./service-rail";

import type { ServiceList } from "@contracts/service";

/**
 * How far back a probe still earns a dot at all. A probe inside 90 s is current (ok/error),
 * older than that up to this horizon is `stale` — the collector stopped hearing back — and
 * beyond it the dot goes away entirely: after a day of silence, "unwatched" is the honest
 * state, not an ever-older amber. The cliff is a day and not ten minutes so that a stalled
 * collector shows a rail full of stale dots, never a rail that pretends nothing was ever
 * probed.
 */
const HEALTH_WINDOW_MS = 24 * 60 * 60_000;

/**
 * The registry, which feeds both the filter list and the service rail.
 *
 * This is the row that makes Iknos reusable without a redeploy: monitoring a new application is
 * an insert, not a code change.
 *
 * Only enabled services are returned. A disabled one is a decision someone made — surfacing it in
 * a filter list would invite filtering by a service that is deliberately not being collected.
 *
 * Since IKN-8 each row carries its health dot and its sparkline, assembled here from two bounded
 * queries for the whole rail — never one query per service: the rail is on every view, and a
 * per-row query would be paid permanently.
 */
@Controller("api/services")
export class ServicesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(): Promise<ServiceList> {
    const startedAt = performance.now();
    const now = new Date();
    // The start of the oldest sparkline minute — also the anchor the SQL measures against, so
    // the bucketing is immune to whatever time zone the MySQL session happens to sit in.
    const windowStart = new Date((Math.floor(now.getTime() / 60_000) - SPARKLINE_SLOTS + 1) * 60_000);

    const services = await this.prisma.service.findMany({
      where: { enabled: true },
      // The rail is a fixed vertical list; alphabetical is the only order that does not move
      // under the cursor between page loads.
      orderBy: { name: "asc" },
      select: { name: true, pm2Name: true, enabled: true },
    });

    const names = services.map((s) => s.name);
    const [healthRows, counts] = await Promise.all([
      this.prisma.healthCheck.findMany({
        where: {
          service: { in: names },
          ts: { gte: new Date(now.getTime() - HEALTH_WINDOW_MS) },
        },
        select: { service: true, ts: true, httpStatus: true, ok: true, latencyMs: true, checks: true },
      }),
      // The `service IN` is not a nicety: without it the only bound is partition pruning and
      // every rail render scans the whole day's log rows. With it, `(service, ts)` serves each
      // registry name as its own one-hour range read — and rows from names that are not in the
      // registry are never fetched at all.
      names.length === 0
        ? Promise.resolve([])
        : this.prisma.$queryRaw<{ service: string; minute: bigint | number; n: bigint | number }[]>`
            SELECT service, FLOOR(TIMESTAMPDIFF(SECOND, ${windowStart}, ts) / 60) AS minute, COUNT(*) AS n
              FROM log_entry
             WHERE service IN (${Prisma.join(names)}) AND ts >= ${windowStart}
             GROUP BY service, minute`,
    ]);

    const firstMinute = Math.floor(windowStart.getTime() / 60_000);
    const health = latestHealthByService(healthRows, now);
    const sparklines = sparklinesByService(
      counts.map((c) => ({ service: c.service, minute: firstMinute + Number(c.minute), n: Number(c.n) })),
      now,
      names,
    );

    return {
      services: services.map((s) => ({
        ...s,
        health: health.get(s.name) ?? null,
        sparkline: sparklines.get(s.name) ?? Array<number>(SPARKLINE_SLOTS).fill(0),
      })),
      meta: { tookMs: Math.round(performance.now() - startedAt) },
    };
  }
}
