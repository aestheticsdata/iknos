import { Prisma } from "@generated/prisma/client";

import type { AlertRow, AlertState, Severity } from "@contracts/alert-row";

/** The one place an `alert` row becomes an `AlertRow` (IKN-15). */

export type RawAlertRow = {
  id: number;
  ruleKey: string;
  service: string;
  severity: string;
  title: string;
  expr: string;
  threshold: number | null;
  unit: string | null;
  value: number | null;
  state: string;
  openedAt: Date;
  firedAt: Date | null;
  resolvedAt: Date | null;
  ackedAt: Date | null;
  silencedUntil: Date | null;
  occurrences: number;
  lastSeenAt: Date;
};

/**
 * Explicit, never `SELECT *` — `open_key` is a generated column the application must never read
 * back or reason about, and naming the columns is what keeps it out of the payload.
 */
export const ALERT_COLUMNS = Prisma.sql`
  id, rule_key AS ruleKey, service, severity, title, expr,
  threshold, unit, value, state,
  opened_at AS openedAt, fired_at AS firedAt, resolved_at AS resolvedAt,
  acked_at AS ackedAt, silenced_until AS silencedUntil,
  occurrences, last_seen_at AS lastSeenAt`;

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

/** A value the column holds but the union does not is read as its safest member, never crashed on. */
const stateOf = (raw: string): AlertState =>
  raw === "pending" || raw === "firing" || raw === "resolved" ? raw : "firing";

const severityOf = (raw: string): Severity =>
  raw === "critical" || raw === "warning" || raw === "info" ? raw : "warning";

const unitOf = (raw: string | null): AlertRow["unit"] =>
  raw === "percent" || raw === "ms" || raw === "count" ? raw : null;

export function toAlertRow(r: RawAlertRow): AlertRow {
  return {
    id: Number(r.id),
    ruleKey: r.ruleKey,
    service: r.service,
    severity: severityOf(r.severity),
    title: r.title,
    expr: r.expr,
    threshold: r.threshold === null ? null : Number(r.threshold),
    unit: unitOf(r.unit),
    value: r.value === null ? null : Number(r.value),
    state: stateOf(r.state),
    openedAt: r.openedAt.toISOString(),
    firedAt: iso(r.firedAt),
    resolvedAt: iso(r.resolvedAt),
    ackedAt: iso(r.ackedAt),
    silencedUntil: iso(r.silencedUntil),
    occurrences: Number(r.occurrences),
    lastSeenAt: r.lastSeenAt.toISOString(),
  };
}
