import type { AlertState } from "./alert-row";

/**
 * One alert's transitions, for the modal's history band (IKN-15).
 *
 * This is the whole reason `alert_state_change` exists as a table. Without it the modal can say
 * "firing, since 14:02" and nothing else — which says nothing at all about an alert that has been
 * flapping every ten minutes since lunch, and telling those two apart is the only question the
 * band answers.
 *
 * Transitions only. A pass that saw the condition still true writes no row: a band that marked
 * every evaluation would be a solid wall at one mark a minute.
 */
export type AlertTransition = {
  /** ISO-8601, UTC. */
  ts: string;
  /** `null` for the transition that opened the alert — there was no state before it. */
  from: AlertState | null;
  to: AlertState;
  /** The reading that caused it, so the band reads without joining back to anything. */
  value: number | null;
};

export type AlertHistory = {
  /** ISO-8601, UTC. The window the band is drawn over, chosen by the server. */
  from: string;
  to: string;
  transitions: AlertTransition[];
};
