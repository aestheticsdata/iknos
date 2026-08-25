import { encodeKeysetCursor } from "@common/keyset-cursor";
import { Controller, Get, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { EVAL_INTERVAL_MS } from "./alert-engine.service";
import { AlertQueryDto, parseAlertId, parseFilters, parseLimit, resolveCursor } from "./alert-query";
import { toAlertRow } from "./alert-row";
import { AlertsService, DEFAULT_HISTORY_MS } from "./alerts.service";

import type { AlertHistory } from "@contracts/alert-history";
import type { AlertCounts, AlertPage } from "@contracts/alert-page";
import type { AlertRow } from "@contracts/alert-row";

/**
 * The alerts view's routes (IKN-15).
 *
 * All behind the global session guard. The three mutations need nothing added here either:
 * `SessionGuard` demands the CSRF header on every method that is not safe, so a `@Post` is
 * protected because it is a `@Post`.
 *
 * `counts` is declared **before** `:id` — Express matches in registration order and a bare
 * parameter above a literal segment swallows it. Third time this codebase has written that down
 * (`logs.controller.ts:98-103`, `issues.controller.ts`), and the first two were bugs.
 */
@Controller("api/alerts")
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get("counts")
  async counts(@Query() p: AlertQueryDto): Promise<AlertCounts> {
    return this.alerts.counts(new Date(), p.service || undefined);
  }

  @Get()
  async list(@Query() p: AlertQueryDto): Promise<AlertPage> {
    const filters = parseFilters(p);
    const limit = parseLimit(p.limit);
    const cursor = resolveCursor(p);
    const now = new Date();

    const startedAt = performance.now();
    // One row more than asked for, purely to learn whether another page exists.
    const found = await this.alerts.list(filters, limit + 1, now, cursor);
    const tookMs = Math.round(performance.now() - startedAt);

    const hasMore = found.length > limit;
    const rows = found.slice(0, limit);
    const last = rows.at(-1);

    return {
      rows: rows.map(toAlertRow),
      nextCursor: hasMore && last ? encodeKeysetCursor(last.lastSeenAt.getTime(), last.id) : null,
      // The engine's cadence, travelling as data rather than being restated in the browser.
      evalIntervalMs: EVAL_INTERVAL_MS,
      meta: { tookMs },
    };
  }

  @Get(":id")
  async detail(@Param("id") id: string): Promise<AlertRow> {
    const row = await this.alerts.byId(parseAlertId(id));
    if (row === null) throw new NotFoundException("no such alert");

    return toAlertRow(row);
  }

  /**
   * The band, over a server-chosen window.
   *
   * Six hours by default — IKN-15's own figure — and the caller does not get to widen it past what
   * the table holds. `alert_state_change` follows the log retention, so a band asking for a month
   * would be honest about a window whose older half has been dropped.
   */
  @Get(":id/history")
  async history(@Param("id") id: string): Promise<AlertHistory> {
    const alertId = parseAlertId(id);
    if ((await this.alerts.byId(alertId)) === null) throw new NotFoundException("no such alert");

    const to = new Date();
    const from = new Date(+to - DEFAULT_HISTORY_MS);

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      transitions: await this.alerts.history(alertId, from, to),
    };
  }

  /**
   * Three verbs, three routes, empty bodies.
   *
   * Distinct acts with distinct buttons, and a verb in the path is what makes the `curl` in a bug
   * report legible. Same shape as the issue mutations, for the same reasons.
   */
  @Post(":id/ack")
  ack(@Param("id") id: string) {
    return this.act(id, (alertId, now) => this.alerts.ack(alertId, now));
  }

  @Post(":id/silence")
  silence(@Param("id") id: string) {
    return this.act(id, (alertId, now) => this.alerts.silence(alertId, now));
  }

  @Post(":id/resolve")
  resolve(@Param("id") id: string) {
    return this.act(id, (alertId, now) => this.alerts.resolve(alertId, now));
  }

  private async act(id: string, run: (alertId: number, now: Date) => Promise<boolean>) {
    const found = await run(parseAlertId(id), new Date());
    if (!found) throw new NotFoundException("no such alert");

    return { ok: true };
  }
}
