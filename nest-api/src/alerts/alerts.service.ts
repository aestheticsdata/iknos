import { PrismaService } from "@db/prisma.service";
import { Prisma } from "@generated/prisma/client";
import { Injectable } from "@nestjs/common";
import { needsAttention, whereClause } from "./alert-query";
import { ALERT_COLUMNS } from "./alert-row";

import type { AlertTransition } from "@contracts/alert-history";
import type { AlertCounts } from "@contracts/alert-page";
import type { AlertFilters } from "./alert-query";
import type { RawAlertRow } from "./alert-row";

/**
 * The read and write side of the alerts view (IKN-15).
 *
 * Raw SQL for the list and the counts — the keyset comparison and the "needs attention" predicate
 * are both `Prisma.Sql` fragments shared with the query builder — and the Prisma model API for the
 * three mutations, which are single-row updates with nothing to express that the client cannot.
 */

/** The mockup's "silence 1 h", and the only duration the action offers. */
export const SILENCE_MS = 60 * 60_000;

/** How far back the modal's history band looks when the caller names no window. */
export const DEFAULT_HISTORY_MS = 6 * 60 * 60_000;

@Injectable()
export class AlertsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A page of alerts, newest activity first.
   *
   * Ordered by `last_seen_at`, **not** by severity, even though the view groups by severity with
   * critical first. Keyset pagination needs one ordering key, and grouping is a rendering of the
   * page the front already holds in full. At this box's volume a page is the whole list.
   */
  async list(filters: AlertFilters, limit: number, now: Date, cursor?: { key: number; id: number }) {
    return this.prisma.$queryRaw<RawAlertRow[]>`
      SELECT ${ALERT_COLUMNS}
        FROM alert
       WHERE ${whereClause(filters, now, cursor)}
       ORDER BY last_seen_at DESC, id DESC
       LIMIT ${limit}`;
  }

  /**
   * How many alerts want attention, by severity.
   *
   * One `GROUP BY` rather than three counts: the numbers are shown together, have to agree with
   * each other, and three round trips could each see a different state of the table while the
   * engine writes. This is the route the rail badge and the status bar both read — IKN-15 requires
   * them to show the same number, and one query is how that stops being a coincidence.
   */
  async counts(now: Date, service?: string): Promise<AlertCounts> {
    const scope = service === undefined ? Prisma.empty : Prisma.sql` AND service = ${service}`;

    const rows = await this.prisma.$queryRaw<{ severity: string; n: bigint | number }[]>`
      SELECT severity, CAST(COUNT(*) AS SIGNED) AS n
        FROM alert
       WHERE ${needsAttention(now)}${scope}
       GROUP BY severity`;

    const found = new Map(rows.map((row) => [row.severity, Number(row.n)]));
    return {
      critical: found.get("critical") ?? 0,
      warning: found.get("warning") ?? 0,
      info: found.get("info") ?? 0,
    };
  }

  async byId(id: number): Promise<RawAlertRow | null> {
    const rows = await this.prisma.$queryRaw<RawAlertRow[]>`
      SELECT ${ALERT_COLUMNS} FROM alert WHERE id = ${id} LIMIT 1`;

    return rows[0] ?? null;
  }

  /**
   * The transitions inside a window, oldest first — the modal's band reads left to right.
   *
   * Bounded, and here the bound is not politeness: `alert_state_change` is partitioned by day, and
   * a query with no lower bound probes every partition in the retention window to find the handful
   * of rows one alert left behind.
   */
  async history(alertId: number, from: Date, to: Date): Promise<AlertTransition[]> {
    const rows = await this.prisma.$queryRaw<
      { ts: Date; fromState: string | null; toState: string; value: number | null }[]
    >`
      SELECT ts, from_state AS fromState, to_state AS toState, value
        FROM alert_state_change
       WHERE alert_id = ${alertId} AND ts >= ${from} AND ts < ${to}
       ORDER BY ts ASC`;

    return rows.map((row) => ({
      ts: row.ts.toISOString(),
      from: (row.fromState ?? null) as AlertTransition["from"],
      to: row.toState as AlertTransition["to"],
      value: row.value === null ? null : Number(row.value),
    }));
  }

  /**
   * Acknowledge — "I have seen this, stop counting it against me".
   *
   * The alert stays open and stays true; it leaves the default segment and nothing else changes.
   * It writes no state-change row, deliberately: nothing transitioned, and the band is a record of
   * what the *condition* did, not of what the reader did about it.
   */
  async ack(id: number, now: Date): Promise<boolean> {
    return this.touch(id, { ackedAt: now });
  }

  /** Silence for an hour. Expires by being a timestamp the read filters on — there is no job. */
  async silence(id: number, now: Date): Promise<boolean> {
    return this.touch(id, { silencedUntil: new Date(+now + SILENCE_MS) });
  }

  /**
   * Resolve by hand.
   *
   * Unlike ack this **is** a transition, so it writes a band row — a reader closing an alert the
   * engine still considers true is exactly the kind of thing the history exists to remember. If
   * the condition does still hold, the next pass opens a fresh episode, which is correct: that is
   * a new incident, and the generated `open_key` column has been free again since `resolved_at`
   * was set.
   */
  async resolve(id: number, now: Date): Promise<boolean> {
    const current = await this.prisma.alert.findUnique({ where: { id }, select: { state: true, resolvedAt: true } });
    if (current === null) return false;
    if (current.resolvedAt !== null) return true;

    await this.prisma.alert.update({ where: { id }, data: { state: "resolved", resolvedAt: now } });
    await this.prisma.alertStateChange.create({
      data: { ts: now, alertId: id, fromState: current.state, toState: "resolved", value: null },
    });

    return true;
  }

  /** Shared by `ack` and `silence`: both are stamps on a row that is otherwise untouched. */
  private async touch(id: number, data: { ackedAt?: Date; silencedUntil?: Date }): Promise<boolean> {
    const found = await this.prisma.alert.findUnique({ where: { id }, select: { id: true } });
    if (found === null) return false;

    await this.prisma.alert.update({ where: { id }, data });
    return true;
  }
}
