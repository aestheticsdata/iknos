import { RESTART_WINDOW_MS } from "../thresholds";

import type { Observation, Rule } from "../rule";

/**
 * A process PM2 has restarted inside the window (IKN-10).
 *
 * **A difference, not a value test.** `process_sample.restarts` is PM2's cumulative counter as of
 * that sample, so the question is how much it moved, and a service that has restarted four times
 * since the box was built is not an incident.
 *
 * Two subtleties, both of which produce a wrong answer if missed:
 *
 * - **A gap in samples means unknown, never zero.** When `pm2 jlist` is unreachable the sampler
 *   writes nothing at all (`scrape.service.ts:220-233`), so an absent window is a blind collector,
 *   not a quiet process. Fewer than two samples answers `null`.
 * - **The counter can go down.** `pm2 delete` and re-add resets it. Taking `MAX - MIN` would then
 *   report the pre-reset total as a burst of restarts. When the last reading is below the first,
 *   the honest reading is the last one itself — *at least this many restarts since the reset* —
 *   which is conservative and still catches the process that is crash-looping.
 */
export const processRestart: Rule = {
  key: "process_restart",
  severity: "critical",
  title: "Process restarted",
  expr: "increase(pm2_restarts[10m]) > 0",
  forMs: 0,
  threshold: 0,
  unit: "count",

  async evaluate(ctx): Promise<Observation[]> {
    const since = new Date(ctx.now - RESTART_WINDOW_MS);

    // Window functions rather than MIN/MAX: the first and last readings *in time order* are the
    // only two a counter difference may be taken between.
    const rows = await ctx.prisma.$queryRaw<
      { pm2Name: string; samples: bigint | number; firstSeen: number; lastSeen: number }[]
    >`
      SELECT pm2Name, samples, firstSeen, lastSeen
        FROM (
          SELECT pm2_name AS pm2Name,
                 COUNT(*)          OVER (PARTITION BY pm2_name)     AS samples,
                 FIRST_VALUE(restarts) OVER w                       AS firstSeen,
                 LAST_VALUE(restarts)  OVER w                       AS lastSeen,
                 ROW_NUMBER()      OVER (PARTITION BY pm2_name ORDER BY ts) AS rn
            FROM process_sample
           WHERE ts >= ${since}
          WINDOW w AS (PARTITION BY pm2_name ORDER BY ts
                       ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
        ) ordered
       WHERE rn = 1`;

    const byPm2 = new Map(rows.map((row) => [row.pm2Name, row]));

    return ctx.targets.map((target): Observation => {
      const row = byPm2.get(target.pm2Name);
      // One sample cannot be differenced, and none means the sampler was blind.
      if (row === undefined || Number(row.samples) < 2) {
        return { service: target.name, value: null, breached: false };
      }

      const first = Number(row.firstSeen);
      const last = Number(row.lastSeen);
      const moved = last >= first ? last - first : last;

      return { service: target.name, value: moved, breached: moved > 0 };
    });
  },
};
