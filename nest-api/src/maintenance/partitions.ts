/**
 * The partition every row lands in until a named one exists for its day.
 *
 * The migration creates only this one, so the table is writable from the first insert and the
 * sliding window is maintenance's problem, not a precondition of ingestion. If this job stops,
 * rows keep arriving here — degraded, not broken (IKN-11).
 */
export const FUTURE_PARTITION = "p_future";

/** How many days ahead the window is kept. Three, so two missed runs still have somewhere to go. */
export const DAYS_AHEAD = 3;

/**
 * When the nightly pass runs, in words — the storage panel's footer line prints it.
 *
 * Declared beside the job rather than in the panel so that moving the cron moves the label with
 * it. A footer that advertises a purge at an hour nothing happens is worse than no footer: it is
 * the line someone reads to decide whether a disk that is still full means the job failed.
 */
export const PURGE_AT = "03:00";

export type Plan = { toCreate: string[]; toDrop: string[] };

const DAY_MS = 24 * 60 * 60 * 1000;

/** `p` + `YYYYMMDD`, in UTC — the same clock `ts` is stored on. */
export function partitionName(date: Date): string {
  return `p${date.toISOString().slice(0, 10).replace(/-/g, "")}`;
}

/**
 * The day a partition holds, or `null` if the name is not one of ours.
 *
 * Returning `null` rather than throwing is deliberate: an unrecognised partition is something a
 * human added, and the correct response to it is to leave it entirely alone.
 */
export function dateOf(name: string): Date | null {
  const m = /^p(\d{4})(\d{2})(\d{2})$/.exec(name);
  if (!m) return null;

  const date = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  // `p20260231` parses as a name and not as a date. NaN here, never a silent 2026-03-03.
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The upper bound of a partition: midnight of the following day, as `TO_DAYS` wants it. */
export function boundaryOf(name: string): string | null {
  const date = dateOf(name);
  if (date === null) return null;

  return new Date(date.getTime() + DAY_MS).toISOString().slice(0, 10);
}

/**
 * Throws unless the name is one this module generated — `p` followed by eight digits.
 *
 * The one guard standing between `$executeRawUnsafe` and an injected statement. Every name that
 * reaches the DDL passes through here first, so the property holds because it is checked, not
 * because every future caller remembered where the names were supposed to come from.
 */
export function assertDayPartition(name: string): void {
  if (dateOf(name) === null) {
    throw new Error(`refusing to build DDL: ${JSON.stringify(name)} is not a day partition`);
  }
}

/** Midnight UTC of the day a clock reading falls in. */
function startOfDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * What the table should gain and lose, given what it has.
 *
 * Pure, and that is the point: date arithmetic is the part of this job that is genuinely easy to
 * get wrong, and it is the part that ends up interpolated into DDL. Testing it needs no database.
 *
 * Only forward: after an outage the missing days are not backfilled. Their rows are already in
 * `p_future` and reorganising it into past partitions would rewrite the whole backlog to buy
 * nothing — queries prune by range either way, and retention will drop the lot on schedule.
 */
export function plan(existing: string[], today: Date, retentionDays: number, daysAhead: number): Plan {
  const start = startOfDay(today);

  const toCreate: string[] = [];
  for (let i = 0; i < daysAhead; i++) {
    const name = partitionName(new Date(start + i * DAY_MS));
    if (!existing.includes(name)) toCreate.push(name);
  }

  // A whole-day cutoff, computed from midnight rather than from the moment the job woke up, so
  // the window is exactly `retentionDays` days and does not drift with the hour it runs at.
  const cutoff = start - retentionDays * DAY_MS;
  const toDrop = existing
    .filter((name) => {
      if (name === FUTURE_PARTITION) return false;
      const date = dateOf(name);
      // An unrecognised name yields null and is therefore never dropped.
      return date !== null && date.getTime() <= cutoff;
    })
    // Oldest first: if the run dies halfway, what it got through is the data nobody wanted.
    .sort();

  return { toCreate, toDrop };
}
