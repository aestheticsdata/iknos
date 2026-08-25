import { logger } from "@common/logger";
import { PrismaService } from "@db/prisma.service";
import { SignalsService } from "@metrics/signals.service";
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { NoopSink } from "./alert-sink";
import { reconcile } from "./reconcile";
import { RULES } from "./rules";
import { METRIC_WINDOW_MS } from "./thresholds";

import type { SignalsResult } from "@metrics/signals.service";
import type { AlertSink } from "./alert-sink";
import type { OpenAlert } from "./reconcile";
import type { Observation, Rule, RuleContext, Severity, Target } from "./rule";

/**
 * The alert engine (IKN-10).
 *
 * **`GrouperService`'s shape, not `MaintenanceService`'s.** A timer field, a boolean latch,
 * `onApplicationBootstrap` arming the interval, `onApplicationShutdown` clearing it, and a pure
 * `pass(now)` the specs drive directly without watching a clock. Not `@Cron`: its schedule is
 * class-definition metadata, and `IssuesModule`'s own comment settles the question — cron is for
 * work that must happen at a wall-clock time, this is work that must happen often.
 *
 * **Every rule is isolated.** One rule's failure costs that rule and nothing else, which is worth
 * saying out loud because the other scheduled job in this process does not do it:
 * `MaintenanceService.execute()`'s loops are unguarded awaits, so one table's DDL failure ends the
 * pass for every table after it. Here a thrown rule is a log line and the next rule still runs.
 *
 * The engine holds **no state between passes**. Everything it needs to know — how long a condition
 * has been true, how many passes have seen it — is on the `alert` row, so a deploy in the middle
 * of a five-minute `for` window resumes rather than restarting the clock.
 */

/** How often the engine evaluates. Travels to the UI on `AlertPage.evalIntervalMs`, never copied. */
export const EVAL_INTERVAL_MS = 60_000;

type OpenRow = OpenAlert & { ruleKey: string; service: string };

@Injectable()
export class AlertEngine implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | null = null;
  private evaluating = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly signals: SignalsService,
    private readonly sink: AlertSink = new NoopSink(),
    private readonly rules: Rule[] = RULES,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.tick(), EVAL_INTERVAL_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * One latched cycle. Never throws — an engine that took the process down with it would trade a
   * missing alerts list for a missing everything, and the failure is a log line the collector
   * ingests, so it is queryable in the tool it broke in.
   */
  async tick(): Promise<void> {
    if (this.evaluating) return;
    this.evaluating = true;
    try {
      await this.pass(Date.now());
    } catch (err) {
      logger.error({ err }, "alert evaluation cycle failed");
    } finally {
      this.evaluating = false;
    }
  }

  /** Evaluate every rule and reconcile. Returns how many transitions it wrote, for the tests. */
  async pass(now: number): Promise<number> {
    const targets = await this.targets();
    if (targets.length === 0) return 0;

    const ctx = this.context(now, targets);
    const open = await this.openAlerts();

    let transitions = 0;
    for (const rule of this.rules) {
      try {
        const observations = await rule.evaluate(ctx);
        for (const observation of observations) {
          const current = open.get(`${rule.key}|${observation.service}`) ?? null;
          transitions += await this.apply(rule, observation, current, now);
        }
      } catch (err) {
        logger.error({ err, rule: rule.key }, "alert rule failed");
      }
    }

    return transitions;
  }

  /**
   * The registry, and what each service can actually answer.
   *
   * A rule iterates the targets that carry its input rather than the whole registry: of nineteen
   * enabled services on ks-b, five carry a health probe and two carry a metrics endpoint, and a
   * metric rule looping over the other seventeen is a partition scan per cycle for services that
   * have never written a sample.
   */
  private async targets(): Promise<Target[]> {
    const rows = await this.prisma.service.findMany({
      where: { enabled: true },
      select: { name: true, pm2Name: true, metricsUrl: true, healthUrl: true },
    });

    return rows.map((row) => ({
      name: row.name,
      pm2Name: row.pm2Name,
      hasMetrics: row.metricsUrl !== null,
      hasHealth: row.healthUrl !== null,
    }));
  }

  /**
   * The context, with `signals` memoised for the pass.
   *
   * `error_rate` and `latency_p95` ask the same question of the same service, and
   * `SignalsService.signals` is two range scans over `metric_sample`. Two rules must not be two
   * round trips.
   */
  private context(now: number, targets: Target[]): RuleContext {
    const cache = new Map<string, Promise<SignalsResult | null>>();
    const at = new Date(now);
    const from = new Date(now - METRIC_WINDOW_MS);

    return {
      prisma: this.prisma,
      now,
      targets,
      signals: (service) => {
        const hit = cache.get(service);
        if (hit !== undefined) return hit;

        // A failed read is `null` — no reading — and never a zero. It is cached too, so a service
        // whose metrics endpoint is down costs one failed query per pass rather than one per rule.
        const pending = this.signals.signals(service, from, at, at).catch((err): null => {
          logger.warn({ err, service }, "signals unavailable for alert evaluation");
          return null;
        });

        cache.set(service, pending);
        return pending;
      },
    };
  }

  /** Every alert that is still open, keyed the way the generated `open_key` column keys them. */
  private async openAlerts(): Promise<Map<string, OpenRow>> {
    const rows = await this.prisma.$queryRaw<
      { id: number; ruleKey: string; service: string; state: string; pendingSince: Date | null; severity: string }[]
    >`
      SELECT id, rule_key AS ruleKey, service, state, pending_since AS pendingSince, severity
        FROM alert
       WHERE resolved_at IS NULL`;

    return new Map(
      rows.map((row) => [
        `${row.ruleKey}|${row.service}`,
        {
          id: Number(row.id),
          ruleKey: row.ruleKey,
          service: row.service,
          state: row.state === "pending" ? "pending" : "firing",
          pendingSince: row.pendingSince,
          severity: row.severity as Severity,
        },
      ]),
    );
  }

  /** Apply one decision. Returns 1 if it wrote a transition, 0 otherwise. */
  private async apply(rule: Rule, observation: Observation, current: OpenRow | null, now: number): Promise<number> {
    const action = reconcile(rule, observation, current, now);
    const at = new Date(now);

    switch (action.kind) {
      case "none":
        return 0;

      case "open": {
        const created = await this.prisma.alert.create({
          data: {
            ruleKey: rule.key,
            service: observation.service,
            severity: action.severity,
            title: rule.title,
            // Copied onto the row rather than joined from the rule: an alert from six months ago
            // should read as the rule that was in force when it fired.
            expr: rule.expr,
            threshold: rule.threshold,
            unit: rule.unit,
            value: observation.value,
            state: action.state,
            openedAt: at,
            pendingSince: at,
            firedAt: action.state === "firing" ? at : null,
            lastSeenAt: at,
          },
        });

        await this.record(created.id, null, action.state, observation.value, at);
        if (action.state === "firing") await this.notify(created.id, rule, observation, action.severity);
        return 1;
      }

      case "promote": {
        if (current === null) return 0;
        await this.prisma.alert.update({
          where: { id: current.id },
          data: {
            state: "firing",
            firedAt: at,
            severity: action.severity,
            value: observation.value,
            lastSeenAt: at,
            occurrences: { increment: 1 },
          },
        });

        await this.record(current.id, "pending", "firing", observation.value, at);
        await this.notify(current.id, rule, observation, action.severity);
        return 1;
      }

      case "touch": {
        if (current === null) return 0;
        // No state change row: nothing transitioned. The band would otherwise be a solid wall of
        // identical marks, one per pass, saying nothing.
        await this.prisma.alert.update({
          where: { id: current.id },
          data: {
            value: observation.value,
            severity: action.severity,
            lastSeenAt: at,
            occurrences: { increment: 1 },
          },
        });
        return 0;
      }

      case "resolve": {
        if (current === null) return 0;
        await this.prisma.alert.update({
          where: { id: current.id },
          data: { state: "resolved", resolvedAt: at, value: observation.value },
        });

        await this.record(current.id, current.state, "resolved", observation.value, at);
        return 1;
      }
    }
  }

  private async record(
    alertId: number,
    from: string | null,
    to: string,
    value: number | null,
    at: Date,
  ): Promise<void> {
    await this.prisma.alertStateChange.create({
      data: { ts: at, alertId, fromState: from, toState: to, value },
    });
  }

  private async notify(id: number, rule: Rule, observation: Observation, severity: Severity): Promise<void> {
    await this.sink.onFiring({
      id,
      ruleKey: rule.key,
      service: observation.service,
      severity,
      title: rule.title,
      expr: rule.expr,
      value: observation.value,
      threshold: rule.threshold,
      unit: rule.unit,
    });
  }
}
