import { PrismaService } from "@db/prisma.service";
import { Injectable } from "@nestjs/common";
import { aggregate, summarize } from "./aggregate";
import { bucketFor } from "./buckets";

import type { SiteSummary, SiteTraffic, TrafficOverview } from "@contracts/traffic";
import type { AccessRow, TrafficQuery } from "./interfaces/traffic-types";

/**
 * Reads a site's access rows and hands them to the pure pass (IKN-83).
 *
 * Computed on every read, and nothing is stored: a site's range is tens of thousands of rows at
 * most, `(service, ts)` serves the read, and keeping no table of its own is what keeps the privacy
 * story simple — there is nothing to expire but the logs themselves (spec §3, D1).
 */

/**
 * The guard against a bot storm, not an expected path: past it the numbers are a floor and the
 * payload says so. Half a million rows of these few columns is a few hundred megabytes at worst.
 */
export const TRAFFIC_ROW_CAP = 500_000;

@Injectable()
export class TrafficService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly retentionDays: number,
  ) {}

  /** One site's dashboard. The caller has already checked that `service` is a registered site. */
  async site(service: string, query: TrafficQuery): Promise<Omit<SiteTraffic, "meta">> {
    const rows = await this.rows(service, query);
    const partial = rows.length > TRAFFIC_ROW_CAP;
    const window = { ...query, retentionDays: this.retentionDays };

    return {
      service,
      partial,
      retentionDays: this.retentionDays,
      // `rows` is in time order with the extra row, if any, at the old end.
      ...aggregate(partial ? rows.slice(1) : rows, window),
    };
  }

  /** One card per enabled site, busiest first. */
  async overview(query: TrafficQuery): Promise<Omit<TrafficOverview, "meta">> {
    const sites = await this.prisma.service.findMany({
      where: { enabled: true, logGlob: { not: null } },
      orderBy: { name: "asc" },
      select: { name: true },
    });

    const window = { ...query, retentionDays: this.retentionDays };
    const summaries: SiteSummary[] = [];
    // One site at a time rather than all at once: each pass holds its rows in memory, and the
    // overview is not worth holding every site's at the same moment.
    for (const { name } of sites) {
      const rows = await this.rows(name, query);
      summaries.push({ service: name, ...summarize(aggregate(rows.slice(-TRAFFIC_ROW_CAP), window)) });
    }

    summaries.sort((a, b) => b.visitorDays - a.visitorDays || b.requests - a.requests);
    return { sites: summaries, bucket: bucketFor(query.from, query.to) };
  }

  /**
   * Only the columns the pass reads, and only the three `attrs` keys it needs — `attrs` also
   * carries the protocol, which nothing here uses. Ordered by `ts`: the first page view of a
   * visitor-day is the one that decides its entry page and source.
   */
  private async rows(service: string, { from, to }: TrafficQuery) {
    /* Newest first, then put back in order: past the cap it is the oldest rows that are left out,
       so a storm truncates the start of the range rather than blanking its most recent days. */
    const newestFirst = await this.prisma.$queryRaw<AccessRow[]>`
      SELECT ts,
             client_ip AS clientIp,
             http_method AS httpMethod,
             route,
             status_code AS statusCode,
             JSON_UNQUOTE(JSON_EXTRACT(attrs, '$.referrer')) AS referrer,
             JSON_UNQUOTE(JSON_EXTRACT(attrs, '$.userAgent')) AS userAgent,
             CAST(JSON_EXTRACT(attrs, '$.bytes') AS SIGNED) AS bytes,
             JSON_UNQUOTE(JSON_EXTRACT(attrs, '$.query')) AS query
        FROM log_entry
       WHERE service = ${service} AND logger = 'nginx.access' AND ts >= ${from} AND ts < ${to}
       ORDER BY ts DESC
       LIMIT ${TRAFFIC_ROW_CAP + 1}`;
    return newestFirst.reverse();
  }
}
