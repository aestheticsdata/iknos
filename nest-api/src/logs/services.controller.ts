import { PrismaService } from "@db/prisma.service";
import { Controller, Get } from "@nestjs/common";

import type { ServiceList } from "@contracts/service";

/**
 * The registry, which feeds both the filter list and the service rail.
 *
 * This is the row that makes Iknos reusable without a redeploy: monitoring a new application is
 * an insert, not a code change.
 *
 * Only enabled services are returned. A disabled one is a decision someone made — surfacing it in
 * a filter list would invite filtering by a service that is deliberately not being collected.
 */
@Controller("api/services")
export class ServicesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(): Promise<ServiceList> {
    const startedAt = performance.now();
    const services = await this.prisma.service.findMany({
      where: { enabled: true },
      // The rail is a fixed vertical list; alphabetical is the only order that does not move
      // under the cursor between page loads.
      orderBy: { name: "asc" },
      select: { name: true, pm2Name: true, enabled: true },
    });

    return { services, meta: { tookMs: Math.round(performance.now() - startedAt) } };
  }
}
