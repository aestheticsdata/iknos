import type { PrismaService } from "@db/prisma.service";
import type { SignalsResult } from "@metrics/signals.service";

/**
 * What a rule is (IKN-10).
 *
 * **A const object with an `evaluate` function, not a class.** The ticket proposed one class per
 * rule registered as a Nest provider; six predicates do not need six providers, and the codebase
 * already says how it spells a closed set of named behaviours — `SORTS` in `issue-query.ts`,
 * `MANAGED_TABLES`, `LEVELS`, `RETENTION_WINDOW`. A record of plain data plus a function is that
 * shape, and it stays testable without a DI container.
 *
 * The field names follow Prometheus (`expr` / `for` / `severity`) deliberately, so that the day
 * this is pointed at a real Alertmanager the rules transpose rather than being rethought.
 */

export const SEVERITIES = ["critical", "warning", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Critical first, always — the order the view groups by and the counts route reports in. */
export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

export const RULE_KEYS = [
  "health_down",
  "process_restart",
  "no_logs",
  "disk_space",
  "error_rate",
  "latency_p95",
] as const;
export type RuleKey = (typeof RULE_KEYS)[number];

/** A service as the registry holds it — everything a rule needs to know whether it applies. */
export type Target = {
  name: string;
  pm2Name: string;
  hasMetrics: boolean;
  hasHealth: boolean;
};

/**
 * What every rule is handed, built once per pass.
 *
 * `signals` is memoised across the pass: `error_rate` and `latency_p95` ask the same question of
 * the same service, and `SignalsService.signals` is two range scans over `metric_sample`. Two
 * rules must not be two round trips.
 */
export type RuleContext = {
  prisma: PrismaService;
  now: number;
  targets: Target[];
  signals(service: string): Promise<SignalsResult | null>;
};

/**
 * One service's answer to one rule.
 *
 * `value` is `null` for **no opinion** — a probe that did not run, a service nobody scrapes. It is
 * never "below threshold" and never zero. The reconciler treats it as neither a breach nor a
 * resolution, which is what stops a scrape outage from silently closing every alert on the box.
 */
export type Observation = {
  service: string;
  value: number | null;
  breached: boolean;
  /** Overrides the rule's severity for this observation. Only `disk_space` uses it. */
  severity?: Severity;
};

export type Rule = {
  key: RuleKey;
  severity: Severity;
  /** Shown beside the expression. Sentence case, no ticket numbers. */
  title: string;
  /**
   * The expression, exactly as the UI prints it. Never reformulated, never translated — IKN-15 is
   * explicit that showing the expression rather than a friendly label is what lets a reader judge
   * whether the alert is wrong or the threshold is.
   */
  expr: string;
  /** How long the condition must hold before `pending` becomes `firing`. `0` fires on sight. */
  forMs: number;
  /** What the reading is compared against. Stored on every alert this rule opens — spec D3. */
  threshold: number | null;
  unit: "percent" | "ms" | "count" | null;
  evaluate(ctx: RuleContext): Promise<Observation[]>;
};
