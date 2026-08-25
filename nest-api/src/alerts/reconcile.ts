import type { Observation, Rule, Severity } from "./rule";

/**
 * The state machine, as one pure function (IKN-10 §2).
 *
 * Separated from the engine for the same reason `keymap.ts` is separated from its listener: this
 * is where the rules a reader would argue about actually live — when a pending alert becomes
 * firing, what a missing reading means, whether an acknowledged alert can resolve — and every one
 * of them is easy to get subtly wrong and impossible to notice afterwards. A pure function over
 * plain objects is exhaustively testable; a method that also writes to MySQL is not.
 */

/** The open alert as the engine reads it back — only the fields a transition depends on. */
export type OpenAlert = {
  id: number;
  state: "pending" | "firing";
  pendingSince: Date | null;
  severity: Severity;
};

export type Action =
  /** No open alert and the condition is true. */
  | { kind: "open"; state: "pending" | "firing"; severity: Severity }
  /** The `for` window has elapsed while pending. */
  | { kind: "promote"; severity: Severity }
  /** Still true, same state — bump `occurrences`, `last_seen_at` and `value`. */
  | { kind: "touch"; severity: Severity }
  /** The condition has stopped being true. */
  | { kind: "resolve" }
  /** Nothing to do, and nothing to record. */
  | { kind: "none" };

/**
 * What this observation means for this alert.
 *
 * **A `null` reading is neither a breach nor a resolution.** It is the absence of an answer — a
 * probe that did not run, a service nobody scrapes, a `pm2 jlist` that failed — and an open alert
 * facing one is left exactly as it was. Treating it as "not breached" would let a collector
 * outage silently close every alert on the box at the moment the box most needs them, which is
 * the single worst thing this file could do.
 *
 * Acknowledgement is deliberately not consulted. An acked alert is still firing and still
 * resolves on its own when the condition lifts — acking silences it in the view, it does not
 * detach it from reality. Silence likewise: `silenced_until` is read at the *view*, never here.
 */
export function reconcile(rule: Rule, observation: Observation, open: OpenAlert | null, now: number): Action {
  const severity = observation.severity ?? rule.severity;

  if (open === null) {
    if (!observation.breached) return { kind: "none" };
    // A rule with no `for` window fires on sight; one with a window starts its clock.
    return { kind: "open", state: rule.forMs === 0 ? "firing" : "pending", severity };
  }

  if (observation.value === null) return { kind: "none" };

  if (!observation.breached) return { kind: "resolve" };

  if (open.state === "pending") {
    // `pendingSince` is null only for a row written by something other than this engine; treating
    // that as "promote now" is the safe direction — an alert stuck pending forever is invisible.
    const since = open.pendingSince?.getTime() ?? now;
    if (now - since >= rule.forMs) return { kind: "promote", severity };
  }

  return { kind: "touch", severity };
}
