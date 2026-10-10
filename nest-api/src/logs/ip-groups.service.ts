import { PrismaService } from "@db/prisma.service";
import { Injectable } from "@nestjs/common";
import { whereClause } from "./log-query";

import type { IpGroup } from "@contracts/ip-groups";
import type { LogFilters } from "./log-query";

/**
 * Hits per client address over the range — the grouping half of IKN-72.
 *
 * The same `whereClause` as the search and the histogram, so the counts here are counts of the
 * very rows the list below would page through: filter the panel to `status:404` and this becomes
 * "who is collecting 404s", with no second filter vocabulary to keep in step.
 */

/** Enough to see who leads by how much; the one-hit tail below it is noise for this question. */
export const MAX_IP_GROUPS = 50;

type RawIpGroup = { ip: string; hits: bigint; routes: bigint; lastSeen: Date };

@Injectable()
export class IpGroupsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * At worst the scan the histogram already runs: the range prunes to its day partitions, and
   * `client_ip IS NOT NULL` lets MySQL walk `(client_ip, ts)` instead when address-bearing lines
   * are the minority. Which plan it takes is left to it — no `FORCE INDEX`; at a few thousand
   * nginx lines a day either one is milliseconds.
   *
   * One row past the cap, for the same reason the search fetches one past its page: the extra row
   * says whether more exist without a second `COUNT(DISTINCT …)` over the same predicate.
   */
  async groups(filters: LogFilters): Promise<{ groups: IpGroup[]; truncated: boolean }> {
    const rows = await this.prisma.$queryRaw<RawIpGroup[]>`
      SELECT client_ip AS ip,
             COUNT(*) AS hits,
             COUNT(DISTINCT route) AS routes,
             MAX(ts) AS lastSeen
        FROM log_entry
       WHERE ${whereClause(filters)} AND client_ip IS NOT NULL
       GROUP BY client_ip
       ORDER BY hits DESC, ip ASC
       LIMIT ${MAX_IP_GROUPS + 1}`;

    return { groups: rows.slice(0, MAX_IP_GROUPS).map(toIpGroup), truncated: rows.length > MAX_IP_GROUPS };
  }
}

/** `COUNT` comes back as a BigInt, which `JSON.stringify` refuses outright. */
export function toIpGroup(r: RawIpGroup): IpGroup {
  return { ip: r.ip, hits: Number(r.hits), routes: Number(r.routes), lastSeen: r.lastSeen.toISOString() };
}
