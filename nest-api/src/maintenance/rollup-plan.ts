/**
 * Which hours the rollup job owes, and in what chunks it pays them (IKN-20). Pure, so the
 * arithmetic that decides whether an hour is ever skipped is tested without a database.
 */

export const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * How long after an hour ends before it is aggregated.
 *
 * A scrape stamped `10:59:58` is written a moment later, and the hourly cron fires at `:07` — but
 * the boot pass can run at `11:00:01`, and an hour aggregated before its last scrape lands would be
 * aggregated short, then never revisited: the cursor has moved past it.
 */
export const ROLLUP_GRACE_MS = 2 * 60_000;

/** A half-open span of whole hours, `[from, to)`. */
export type HourRange = {
  from: Date;
  to: Date;
};

/** What the plan is computed from. */
export type PendingInput = {
  /** The newest rollup row's `ts` — the last reading of the newest hour done — or `null` if none. */
  newest: Date | null;
  now: Date;
  /** `IKNOS_METRIC_RETENTION_DAYS`: nothing older than this can still be read raw. */
  rawWindowDays: number;
};

export const floorHour = (at: Date): Date => new Date(Math.floor(+at / HOUR_MS) * HOUR_MS);

/**
 * The hours still to aggregate, or `null` when there are none.
 *
 * Starts after the hour the newest rollup belongs to — a rollup's `ts` is its hour's last reading,
 * so flooring it gives that hour — or, on a first run, at the oldest hour raw samples can still
 * hold. Never earlier than that either way: an hour whose partition is gone has nothing to give,
 * and aggregating it would only delete whatever rollups it already had.
 *
 * Ends at the last hour that finished more than `ROLLUP_GRACE_MS` ago.
 */
export function pendingHours({ newest, now, rawWindowDays }: PendingInput): HourRange | null {
  const oldestRaw = floorHour(new Date(+now - rawWindowDays * DAY_MS));
  const next = newest === null ? oldestRaw : new Date(+floorHour(newest) + HOUR_MS);

  const from = new Date(Math.max(+next, +oldestRaw));
  const to = floorHour(new Date(+now - ROLLUP_GRACE_MS));

  return +from < +to ? { from, to } : null;
}

/**
 * The range cut on UTC midnights — one statement per `metric_sample` day partition.
 *
 * Without an index that leads with `ts`, aggregating one hour reads its whole day partition
 * (7 s on ks-b, 2026-10-09). Grouping a day's missing hours into one statement makes catching up
 * after a long stop one scan per day rather than one per hour.
 */
export function dayChunks(range: HourRange): HourRange[] {
  const chunks: HourRange[] = [];
  let from = range.from;

  while (+from < +range.to) {
    const midnight = new Date((Math.floor(+from / DAY_MS) + 1) * DAY_MS);
    const to = new Date(Math.min(+midnight, +range.to));
    chunks.push({ from, to });
    from = to;
  }

  return chunks;
}
