import type { ServiceHealth } from "@contracts/service";

/**
 * The arithmetic behind the enriched service rail (IKN-8), pure and apart from the queries:
 * which probe row is current, when it stops being, and how grouped log counts become the sixty
 * minute-buckets of a sparkline.
 */

/** Twice the probe cadence plus slack: one missed probe is jitter, two is a statement. */
const STALE_AFTER_MS = 90_000;

export const SPARKLINE_SLOTS = 60;

export type HealthRow = {
  service: string;
  ts: Date;
  httpStatus: number | null;
  ok: boolean;
  latencyMs: number | null;
  checks: unknown;
};

export function latestHealthByService(
  rows: HealthRow[],
  now: Date,
  staleAfterMs: number = STALE_AFTER_MS,
): Map<string, ServiceHealth> {
  const latest = new Map<string, HealthRow>();
  for (const row of rows) {
    const seen = latest.get(row.service);
    if (!seen || row.ts > seen.ts) latest.set(row.service, row);
  }

  const health = new Map<string, ServiceHealth>();
  for (const [service, row] of latest) {
    const stale = now.getTime() - row.ts.getTime() > staleAfterMs;
    health.set(service, {
      status: stale ? "stale" : row.ok ? "ok" : "error",
      httpStatus: row.httpStatus,
      latencyMs: row.latencyMs,
      checkedAt: row.ts.toISOString(),
      checks: isChecks(row.checks) ? row.checks : null,
    });
  }
  return health;
}

export type MinuteCount = { service: string; minute: number; n: number };

/**
 * Sixty buckets per requested service, oldest first, the newest being the minute `now` falls
 * in. Counts outside the window are dropped, never wrapped. Every requested service gets a
 * line: sixty zeros is a true statement about an idle service.
 */
export function sparklinesByService(
  counts: MinuteCount[],
  now: Date,
  services: string[],
  slots: number = SPARKLINE_SLOTS,
): Map<string, number[]> {
  const nowMinute = Math.floor(now.getTime() / 60_000);
  const first = nowMinute - slots + 1;

  const lines = new Map<string, number[]>(services.map((s) => [s, Array<number>(slots).fill(0)]));
  for (const count of counts) {
    const line = lines.get(count.service);
    if (!line) continue;
    const index = count.minute - first;
    if (index < 0 || index >= slots) continue;
    line[index] = count.n;
  }
  return lines;
}

function isChecks(value: unknown): value is Record<string, { status: string; latencyMs: number }> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
