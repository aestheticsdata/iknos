/**
 * What the alert routes return, restated — the authoritative copy is
 * `nest-api/src/contracts/alert-*.ts`, like every other contract in this front end.
 *
 * There is no shared package and there never was: `nest-api` and `front` are independent pnpm
 * roots, and neither half can break the other's build. When a field changes there it changes here.
 */

import type { Meta } from "@lib/logTypes";

export type Severity = "critical" | "warning" | "info";

/** Acked and silenced are stamps on a firing row, not states — see the API contract. */
export type AlertState = "pending" | "firing" | "resolved";

export type AlertRow = {
  id: number;
  ruleKey: string;
  service: string;
  severity: Severity;
  title: string;
  /** Printed verbatim. Never reformulated — that is the whole point of showing it (IKN-15 §1). */
  expr: string;
  threshold: number | null;
  unit: "percent" | "ms" | "count" | null;
  /** `null` is **no reading**, never zero and never "below threshold". */
  value: number | null;
  state: AlertState;
  openedAt: string;
  firedAt: string | null;
  resolvedAt: string | null;
  ackedAt: string | null;
  silencedUntil: string | null;
  occurrences: number;
  lastSeenAt: string;
};

export type AlertPage = {
  rows: AlertRow[];
  nextCursor: string | null;
  /** The engine's real cadence, from the server. The modal shows this, never a copy. */
  evalIntervalMs: number;
  meta: Meta;
};

export type AlertCounts = Record<Severity, number>;

export type AlertTransition = {
  ts: string;
  from: AlertState | null;
  to: AlertState;
  value: number | null;
};

export type AlertHistory = {
  from: string;
  to: string;
  transitions: AlertTransition[];
};

/** The segments of the alerts view, in the order they are shown. */
export const ALERT_VIEWS = ["open", "acked", "resolved", "all"] as const;
export type AlertView = (typeof ALERT_VIEWS)[number];

/** Critical first, always. The view groups on this and the counts route reports in this order. */
export const SEVERITIES: Severity[] = ["critical", "warning", "info"];
