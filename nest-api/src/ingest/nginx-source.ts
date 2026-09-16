import { parseCombined } from "./nginx-parser";

import type { PrismaService } from "@db/prisma.service";
import type { LogRecord } from "./log-record";
import type { Source, SourceFile } from "./source";

/**
 * The half of the traffic no application can report: what nginx answered without ever proxying.
 *
 * A 503 from `limit_req`, a probe for `/wp-login.php`, a 404 on a route no app serves — and the
 * case that brought this forward, a static site with no PM2 process at all, whose visitors are
 * otherwise invisible.
 *
 * **Its files come from the registry, not from a glob**, which is the difference from `Pm2Source`
 * and the reason `Service.logGlob` was reserved. Adding a site stays what the registry has always
 * promised: one row, no code change, no redeploy.
 *
 * Each vhost must write its own access log — `combined` carries no `$host` field, so lines in the
 * shared `/var/log/nginx/access.log` cannot be attributed to a site at all. That is a one-line
 * change per vhost on ks-b, documented in DEPLOY.md, and the same one Zeus made for itself.
 *
 * No `@Injectable()`: like `Pm2Source`, this is constructed by hand in the module's factory, which
 * is where the Prisma client it needs is already in scope.
 */
export class NginxSource implements Source {
  readonly name = "nginx";

  constructor(private readonly prisma: PrismaService) {}

  /**
   * `enabled` is honoured for the reason the scraper honours it (`scrape.service.ts:119`): a
   * service someone paused stays paused, and pausing has to stop the reading rather than merely
   * hide what was read.
   *
   * A throw here — the database being down — is caught by `Tailer.poll`, which logs it and sweeps
   * the PM2 source anyway. That ordering matters: the PM2 logs are exactly what someone is
   * reading while MySQL is the problem.
   */
  async files(): Promise<SourceFile[]> {
    const rows = await this.prisma.service.findMany({
      where: { enabled: true, logGlob: { not: null } },
      select: { name: true, logGlob: true },
    });

    return rows.flatMap((row) =>
      row.logGlob === null ? [] : [{ file: row.logGlob, service: row.name, stream: "out" as const }],
    );
  }

  /**
   * **`stream` is omitted rather than ignored**, which is legal for an implementation of `Source`
   * and says more than a discarded parameter would.
   *
   * It exists to decide the fallback level for a line that carries none, and a combined line
   * always has a status code to derive one from. There is also no honest value to pass: `"err"`
   * would be a lie about every 200 in an access log.
   */
  parse(line: string, service: string): LogRecord | null {
    return parseCombined(line, service);
  }
}
