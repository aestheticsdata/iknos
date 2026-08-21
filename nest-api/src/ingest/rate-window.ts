/**
 * The last hour of ingestion, one bucket per minute, held in the collector's own memory.
 *
 * This is what the rail's `INGEST · 60m` sparkline draws (IKN-24). It is a ring rather than a
 * query because the alternative — `GROUP BY` over `log_entry` every time a browser asks — puts the
 * one card whose job is to say "ingestion is fine" behind the very table that fails first. A
 * counter in memory answers while MySQL is on fire, which is the only moment it matters.
 *
 * The cost of that choice is that a restart clears it, and the card then draws a rising line for
 * an hour. That is the truthful picture: the process genuinely does not know what happened before
 * it started, and `snapshot` returns `null` until the first line lands rather than a confident row
 * of zeroes — zero and "I do not know" are different facts, and the whole ticket turns on not
 * confusing them.
 */

/** Sixty minutes, which is what the card's heading promises. */
export const WINDOW_MINUTES = 60;

const MINUTE_MS = 60_000;

export type RateSnapshot = {
  /** One count per minute, oldest first, exactly `WINDOW_MINUTES` long. */
  lines: number[];
  /** Lines over the whole window. */
  total: number;
  /** Bytes over the whole window. */
  bytes: number;
};

const minuteOf = (at: number): number => Math.floor(at / MINUTE_MS);

export class RateWindow {
  /** Ring slots, indexed by `minute % WINDOW_MINUTES`. `minute` identifies what a slot holds. */
  private readonly slots: { minute: number; lines: number; bytes: number }[] = Array.from(
    { length: WINDOW_MINUTES },
    () => ({ minute: -1, lines: 0, bytes: 0 }),
  );

  /** The newest minute ever written, which is how a stale slot is told from a live one. */
  private latest = -1;

  record(at: number, lines: number, bytes: number): void {
    const minute = minuteOf(at);
    const slot = this.slots[minute % WINDOW_MINUTES];

    // A slot still holding a different minute is a whole revolution old: reset rather than add,
    // or an hour-old count would be handed back as if it were this minute's.
    if (slot.minute !== minute) {
      slot.minute = minute;
      slot.lines = 0;
      slot.bytes = 0;
    }

    slot.lines += lines;
    slot.bytes += bytes;
    // Never moves backwards. A clock stepped back by NTP would otherwise make every slot ahead of
    // it look current again, resurrecting counts that had already scrolled out of the window.
    this.latest = Math.max(this.latest, minute);
  }

  /**
   * The window as of `now`, or `null` if nothing has ever been recorded.
   *
   * Read at the caller's clock rather than at the last write's, so a collector that has gone quiet
   * shows the line falling to zero instead of holding its last value forever.
   */
  snapshot(now: number): RateSnapshot | null {
    if (this.latest < 0) return null;

    // The window ends at whichever minute is later: a `now` behind the last write means the clock
    // moved, and scrolling backwards would hide lines that were genuinely counted.
    const end = Math.max(minuteOf(now), this.latest);
    const start = end - WINDOW_MINUTES + 1;

    const lines: number[] = [];
    let total = 0;
    let bytes = 0;

    for (let minute = start; minute <= end; minute++) {
      const slot = this.slots[((minute % WINDOW_MINUTES) + WINDOW_MINUTES) % WINDOW_MINUTES];
      // A slot whose minute is not the one being asked for was never written, or belongs to an
      // earlier revolution. Either way this minute saw nothing, and a zero is the true answer.
      const count = slot.minute === minute ? slot.lines : 0;
      lines.push(count);
      total += count;
      bytes += slot.minute === minute ? slot.bytes : 0;
    }

    return { lines, total, bytes };
  }
}
