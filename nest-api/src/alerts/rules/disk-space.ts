import { DISK_CRITICAL_PCT, DISK_FOR_MS, DISK_WARN_PCT } from "../thresholds";

import type { Observation, Rule } from "../rule";

/** The one service name a host-wide rule can honestly carry. */
export const HOST = "ks-b";

/**
 * The root filesystem filling up (IKN-10).
 *
 * **Host-wide, so it opens one alert under the host's own name** rather than nineteen identical
 * ones. `service` on the alert row is a scope, not a claim about who caused it.
 *
 * Reads `host_sample`, which is `statfs("/")` sampled every 30 s — and this is the table's first
 * reader in the codebase. The other disk number in the product, `StorageService.readDisk()`, is
 * `statfs(process.cwd())` behind a five-minute cache and private to its module; it answers a
 * different question about a different mount, and a rule re-reading a cached value five times a
 * cycle would be measuring the cache.
 *
 * The severity is chosen **per observation** — warning at 85 %, critical at 95 % — which is the
 * only reason `Observation.severity` exists.
 */
export const diskSpace: Rule = {
  key: "disk_space",
  severity: "warning",
  title: "Disk filling up",
  expr: `disk_used / disk_total > ${DISK_WARN_PCT}%`,
  forMs: DISK_FOR_MS,
  threshold: DISK_WARN_PCT,
  unit: "percent",

  async evaluate(ctx): Promise<Observation[]> {
    const rows = await ctx.prisma.$queryRaw<{ used: bigint | null; total: bigint | null }[]>`
      SELECT disk_used_bytes AS used, disk_total_bytes AS total
        FROM host_sample
       WHERE ts >= ${new Date(ctx.now - 10 * 60_000)}
       ORDER BY ts DESC
       LIMIT 1`;

    const row = rows[0];
    // The columns are nullable and null means statfs refused — never 0 %. No sample at all means
    // the host sampler is not running, which is likewise not a disk reading.
    if (row === undefined || row.used === null || row.total === null || Number(row.total) === 0) {
      return [{ service: HOST, value: null, breached: false }];
    }

    const pct = (Number(row.used) / Number(row.total)) * 100;

    return [
      {
        service: HOST,
        value: Number(pct.toFixed(1)),
        breached: pct > DISK_WARN_PCT,
        severity: pct > DISK_CRITICAL_PCT ? "critical" : "warning",
      },
    ];
  },
};
