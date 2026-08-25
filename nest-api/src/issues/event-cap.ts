/**
 * The per-issue, per-minute ceiling on `issue_event` rows (IKN-9 §5).
 *
 * An error in a render loop throws thousands of times a minute. Every one of them must be
 * *counted* — `issue.event_count` is the number the panel prints and it has to be true — but
 * writing thousands of `issue_event` rows for it would fill the disk with one sample repeated,
 * and the sparkline drawn from them says exactly what twenty would have said.
 *
 * **The count stays exact and the samples are capped.** That is the same trade the writer makes
 * when it pro-rates a truncated chunk's bytes rather than carrying a length per record: be
 * approximate about the thing nobody reads precisely, be exact about the thing on screen.
 *
 * Held in process memory, like every other collector counter — `rate-window.ts` records why: a
 * limiter that asks MySQL for permission is asking the thing that is already struggling. A
 * restart forgets the window, which costs at most one minute of over-sampling for one issue.
 */

const MINUTE_MS = 60_000;

/** How many stale fingerprints may sit in the map before it is swept. */
const SWEEP_AT = 4_096;

export class EventCap {
  /** fingerprint → the minute it was last written in, and how many landed in that minute. */
  private readonly seen = new Map<string, { minute: number; written: number }>();

  constructor(private readonly perMinute: number) {}

  /**
   * Whether this occurrence may be written as a row, and books it if so.
   *
   * Not idempotent: calling it is taking the slot. The caller asks once per occurrence.
   */
  allow(fingerprint: string, at: number): boolean {
    // A ceiling of zero means zero. Checked before the slot is booked rather than after, or the
    // first occurrence of every minute would slip through a cap set to refuse everything.
    if (this.perMinute <= 0) return false;

    const minute = Math.floor(at / MINUTE_MS);
    const slot = this.seen.get(fingerprint);

    if (slot === undefined || slot.minute !== minute) {
      // A fingerprint whose last write was in an earlier minute starts fresh rather than being
      // deleted and re-added: the entry is one object either way, and reusing it keeps the map's
      // size a function of live fingerprints instead of churn.
      if (this.seen.size >= SWEEP_AT) this.sweep(minute);
      this.seen.set(fingerprint, { minute, written: 1 });
      return true;
    }

    if (slot.written >= this.perMinute) return false;

    slot.written += 1;
    return true;
  }

  /**
   * Drop fingerprints that cannot be relevant any more.
   *
   * Unbounded in principle — a fingerprint is a hash and an attacker-ish workload could mint new
   * ones forever — so the map is swept rather than trusted. Anything from a previous minute has
   * already lost its slot semantically; deleting it changes no answer.
   */
  private sweep(minute: number): void {
    for (const [fingerprint, slot] of this.seen) {
      if (slot.minute < minute) this.seen.delete(fingerprint);
    }
  }
}
