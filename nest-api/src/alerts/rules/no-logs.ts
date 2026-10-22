import { BUSY_MIN_LINES, BUSY_WINDOW_MS, SILENCE_AFTER_MS } from "../thresholds";

import type { Observation, Rule } from "../rule";

/**
 * A service that was busy and has gone silent (IKN-10, reframed — see `SILENCE_AFTER_MS`).
 *
 * The ticket asks for "no line in 15 minutes". Measured against ks-b that fires for most of the
 * fleet every night: eight of nineteen services logged nothing in twenty-four hours, and the
 * busiest service in the fleet still has a ten-hour overnight gap. A threshold above those gaps
 * would be a day wide and would catch nothing worth catching.
 *
 * So the predicate is a **pair** of windows: at least `BUSY_MIN_LINES` in the hour that ended
 * fifteen minutes ago, and nothing since. A service that is merely idle fails the first half and
 * is never alerted on; a service that dies mid-traffic satisfies both within one pass. The value
 * shown is how many lines it *was* producing, which is what makes the silence legible.
 *
 * Both windows carry their own lower bound — `log_entry` is partitioned by day and an unbounded
 * scan here is exactly the failure `logs/log-query.ts` refuses at the API edge.
 */
export const noLogs: Rule = {
  key: "no_logs",
  severity: "warning",
  title: "Service has gone silent",
  expr: `log_lines[1h] >= ${BUSY_MIN_LINES} and absent(log_lines[15m])`,
  forMs: 0,
  threshold: BUSY_MIN_LINES,
  unit: "count",

  async evaluate(ctx): Promise<Observation[]> {
    const quietFrom = new Date(ctx.now - SILENCE_AFTER_MS);
    const busyFrom = new Date(ctx.now - SILENCE_AFTER_MS - BUSY_WINDOW_MS);

    const rows = await ctx.prisma.$queryRaw<{ service: string; busy: bigint | number; quiet: bigint | number }[]>`
      SELECT service,
             CAST(SUM(ts <  ${quietFrom}) AS SIGNED) AS busy,
             CAST(SUM(ts >= ${quietFrom}) AS SIGNED) AS quiet
        FROM log_entry
       WHERE ts >= ${busyFrom}
       GROUP BY service`;

    const seen = new Map(rows.map((row) => [row.service, row]));

    return ctx.targets.map((target): Observation => {
      const row = seen.get(target.name);
      const busy = row === undefined ? 0 : Number(row.busy);
      const quiet = row === undefined ? 0 : Number(row.quiet);

      // A line since the cut-off is the one reading that settles it: the service is talking, so an
      // open alert resolves — however quiet the hour before was.
      if (quiet > 0) return { service: target.name, value: busy, breached: false };

      // Silent, but not busy enough beforehand for silence to mean anything. `null`, not `false`:
      // an alert opened while the service was busy must survive the hour that slides out of the
      // busy window, or every silence would close itself seventy-five minutes in. Before IKN-81,
      // a service that came back quietly never cleared the busy bar again and its alert stayed
      // firing for days.
      if (busy < BUSY_MIN_LINES) return { service: target.name, value: null, breached: false };

      return { service: target.name, value: busy, breached: true };
    });
  },
};
