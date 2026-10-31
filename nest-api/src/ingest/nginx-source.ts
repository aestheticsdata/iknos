import { SITE_WHERE } from "@traffic/sites";
import { parseCombined, trailingHost } from "./nginx-parser";

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
 * A site reaches it by one of two doors. A vhost that writes its own file names it in `logGlob`,
 * and every line of that file is the site's. Every other vhost writes to the shared
 * `/var/log/nginx/access.log`, whose global format ends on `"$host"` (IKN-84): the site's row lists
 * its domains in `hosts`, and each shared line goes to the row that claims its host. That second
 * door is what makes a new site a registry row and nothing in its own project.
 *
 * No `@Injectable()`: like `Pm2Source`, this is constructed by hand in the module's factory, which
 * is where the Prisma client it needs is already in scope.
 */
/** The service the shared file is listed under. Never stored: `parse` replaces it per line. */
export const SHARED_SERVICE = "nginx-shared";

export class NginxSource implements Source {
  readonly name = "nginx";

  /** Host to service, rebuilt with the file list on every tick so a new row is read at once. */
  private sites = new Map<string, string>();

  /** `sharedLog` is `null` where there is no shared file to read — a laptop, the test suite. */
  constructor(
    private readonly prisma: PrismaService,
    private readonly sharedLog: string | null,
  ) {}

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
      where: { enabled: true, ...SITE_WHERE },
      orderBy: { name: "asc" },
      select: { name: true, logGlob: true, hosts: true },
    });

    const sites = new Map<string, string>();
    for (const row of rows) {
      for (const host of (row.hosts ?? "").toLowerCase().split(/\s+/)) {
        // First row wins a host two rows claim, so a typo cannot move a site's traffic silently.
        if (host !== "" && !sites.has(host)) sites.set(host, row.name);
      }
    }
    this.sites = sites;

    const own = rows.flatMap((row) =>
      row.logGlob === null ? [] : [{ file: row.logGlob, service: row.name, stream: "out" as const }],
    );
    // Only once a row claims a host: before that, every line of the shared file would be dropped.
    const shared =
      this.sharedLog !== null && sites.size > 0
        ? [{ file: this.sharedLog, service: SHARED_SERVICE, stream: "out" as const }]
        : [];
    return [...own, ...shared];
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
    if (service !== SHARED_SERVICE) return parseCombined(line, service);

    // Every vhost without a file of its own writes here, sites Iknos does not know included. A
    // line no row claims is not this instance's to keep, and one the pattern cannot read has no
    // site to be filed under — both dropped rather than stored as noise.
    const host = trailingHost(line);
    const site = host === null ? undefined : this.sites.get(host);
    if (site === undefined) return null;

    const record = parseCombined(line, site);
    return record === null || record.degraded ? null : record;
  }
}
