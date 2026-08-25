import type { AlertRow, Severity } from "./alert-row";
import type { Meta } from "./meta";

/**
 * A page of alerts (IKN-15).
 *
 * Keyset like every other list here, ordered by `lastSeenAt` — `nextCursor` is opaque and the
 * client's whole contract with it is to hand it back.
 */
export type AlertPage = {
  rows: AlertRow[];
  nextCursor: string | null;
  /**
   * How often the engine evaluates, in milliseconds.
   *
   * On the payload rather than in a config variable the browser also reads, which is the honest
   * form of what IKN-10 §3 asked for: the number has one home, in the engine, and travels as data.
   * The mockup says 15 s and the engine runs at 60 s — exactly the kind of figure that lies for two
   * years once it is copied into a second file.
   */
  evalIntervalMs: number;
  meta: Meta;
};

/**
 * How many alerts want attention, by severity.
 *
 * **Firing, not acknowledged, not currently silenced.** This is the number on the rail badge and
 * in the status bar, and both are answering "is there anything I should look at" — an alert
 * someone has already acknowledged is not, which is what acknowledging it said.
 *
 * `pending` alerts are excluded for the same reason: the `for` window exists precisely so that a
 * condition which has not yet persisted does not interrupt anybody.
 */
export type AlertCounts = Record<Severity, number>;
