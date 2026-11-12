import { ERROR_LEVEL } from "@issues/error-fields";
import { ACTION_FAILURES_MIN, BROWSER_DATASET_SUFFIX, BROWSER_ERRORS_SPIKE, LOG_RULE_WINDOW_MS } from "../thresholds";

import type { Observation, Rule, RuleContext } from "../rule";

/**
 * Two rules that read what a line says rather than how many there are (asked for by Tomos's TOM-72:
 * "renderer errors spike", "signing failures"). Both are written on ECS conventions, not on Tomos,
 * so any app on the box gets them by logging the same fields.
 *
 * `error.*` and `event.*` are not promoted to columns, so they are read out of `attrs` — in both
 * ECS shapes, dotted (`"event.dataset"`, pino's ECS formatter) and nested (`{event: {dataset}}`),
 * for the reason `ingest/parser.ts#lookup` gives. Both scans are bounded by the window, as every
 * read of the day-partitioned `log_entry` must be.
 */

const WARN_LEVEL = 40;

/** One count per service; a target with no row counted zero, which resolves an open alert. */
const countsPerTarget = (
  ctx: RuleContext,
  rows: { service: string; n: bigint | number }[],
  atLeast: number,
): Observation[] => {
  const counts = new Map(rows.map((row) => [row.service, Number(row.n)]));
  return ctx.targets.map((target): Observation => {
    const value = counts.get(target.name) ?? 0;
    return { service: target.name, value, breached: value >= atLeast };
  });
};

/**
 * Browser errors relayed through an app's own API — WebGPU device loss, shader compile failures,
 * unreadable files, worker crashes — arriving faster than page loads normally fail.
 */
export const browserErrors: Rule = {
  key: "browser_errors",
  severity: "warning",
  title: "Browser errors spiking",
  expr: `count(level>=error, event.dataset=~"*${BROWSER_DATASET_SUFFIX}")[10m] >= ${BROWSER_ERRORS_SPIKE}`,
  forMs: 0,
  threshold: BROWSER_ERRORS_SPIKE,
  unit: "count",

  async evaluate(ctx): Promise<Observation[]> {
    const from = new Date(ctx.now - LOG_RULE_WINDOW_MS);
    const suffix = `%${BROWSER_DATASET_SUFFIX}`;
    const rows = await ctx.prisma.$queryRaw<{ service: string; n: bigint | number }[]>`
      SELECT service, COUNT(*) AS n
        FROM log_entry
       WHERE ts >= ${from}
         AND level >= ${ERROR_LEVEL}
         AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(attrs, '$."event.dataset"')),
                      JSON_UNQUOTE(JSON_EXTRACT(attrs, '$.event.dataset'))) LIKE ${suffix}
       GROUP BY service`;
    return countsPerTarget(ctx, rows, BROWSER_ERRORS_SPIKE);
  },
};

/**
 * A business action that failed: a line naming `event.action` (`report.sign`) with
 * `event.outcome: failure`. Critical, and on sight — an app only marks the actions whose failure
 * someone must hear about, so the first one is the incident.
 */
export const actionFailures: Rule = {
  key: "action_failures",
  severity: "critical",
  title: "A business action failed",
  expr: `count(event.action, event.outcome="failure")[10m] >= ${ACTION_FAILURES_MIN}`,
  forMs: 0,
  threshold: ACTION_FAILURES_MIN,
  unit: "count",

  async evaluate(ctx): Promise<Observation[]> {
    const from = new Date(ctx.now - LOG_RULE_WINDOW_MS);
    const rows = await ctx.prisma.$queryRaw<{ service: string; n: bigint | number }[]>`
      SELECT service, COUNT(*) AS n
        FROM log_entry
       WHERE ts >= ${from}
         AND level >= ${WARN_LEVEL}
         AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(attrs, '$."event.outcome"')),
                      JSON_UNQUOTE(JSON_EXTRACT(attrs, '$.event.outcome'))) = 'failure'
         AND COALESCE(JSON_EXTRACT(attrs, '$."event.action"'), JSON_EXTRACT(attrs, '$.event.action')) IS NOT NULL
       GROUP BY service`;
    return countsPerTarget(ctx, rows, ACTION_FAILURES_MIN);
  },
};
