import { HEALTH_FAILURES, HEALTH_WINDOW_MS } from "../thresholds";

import type { Observation, Rule } from "../rule";

/**
 * A service whose health endpoint has failed twice in a row (IKN-10).
 *
 * Reads a **window**, not the last two rows — see `HEALTH_WINDOW_MS` for why the obvious
 * `ORDER BY ts DESC LIMIT 2` silently misses outages at this cadence.
 *
 * A service with a `healthUrl` and no probe in the window gets `null`: nobody asked it, so nothing
 * is known. That is not the same as healthy, and it is not the same as down — it means the
 * collector is not probing, which is a different problem with a different fix.
 */
export const healthDown: Rule = {
  key: "health_down",
  severity: "critical",
  title: "Health endpoint failing",
  expr: `probe_failures[90s] >= ${HEALTH_FAILURES}`,
  forMs: 0,
  threshold: HEALTH_FAILURES,
  unit: "count",

  async evaluate(ctx): Promise<Observation[]> {
    const probed = ctx.targets.filter((target) => target.hasHealth);
    if (probed.length === 0) return [];

    const since = new Date(ctx.now - HEALTH_WINDOW_MS);
    const rows = await ctx.prisma.$queryRaw<{ service: string; failures: bigint | number }[]>`
      SELECT service, CAST(SUM(ok = FALSE) AS SIGNED) AS failures
        FROM health_check
       WHERE ts >= ${since}
       GROUP BY service`;

    const seen = new Map(rows.map((row) => [row.service, Number(row.failures)]));

    return probed.map((target) => {
      const failures = seen.get(target.name);
      // Not `?? 0`. A service nobody probed has no reading, and a zero here would report every
      // unprobed service as healthy — the one thing a monitoring tool must never do.
      if (failures === undefined) return { service: target.name, value: null, breached: false };
      return { service: target.name, value: failures, breached: failures >= HEALTH_FAILURES };
    });
  },
};
