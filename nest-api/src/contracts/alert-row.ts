/**
 * One alerting episode as it crosses the wire (IKN-10, IKN-15).
 *
 * **Keyed on `id`, unlike an issue.** A fingerprint is a stable public identity — the same error
 * is the same sixteen characters for as long as the code is wrong — so it belongs in URLs. An
 * alert is an episode with a beginning and an end, and the same rule firing on the same service in
 * March and again in August is genuinely two rows. There is nothing to key it on but the id.
 *
 * `expr` and `threshold` are carried rather than looked up, and that is the whole of spec D3: the
 * front is a separate pnpm root and cannot import a constant from the engine, so a threshold that
 * travels with the alert is the only shape in which the modal and the rule cannot disagree about
 * what was being asked. It also means an alert from six months ago still reads as the rule that
 * was in force when it fired.
 */

export type Severity = "critical" | "warning" | "info";

/**
 * `pending` — the condition holds but its `for` window has not elapsed.
 * `firing` — open and counting.
 * `resolved` — the condition lifted, automatically or by hand.
 *
 * Acknowledged and silenced are **not** states: they are `ackedAt` and `silencedUntil` on a row
 * that is still firing. An acknowledged alert is still true, which is the point of acknowledging
 * it rather than resolving it.
 */
export type AlertState = "pending" | "firing" | "resolved";

export type AlertRow = {
  id: number;
  ruleKey: string;
  /** The scope, not a culprit — `disk_space` carries the host's own name. */
  service: string;
  severity: Severity;
  title: string;
  /** The rule's expression, verbatim. Printed as-is; never reformulated, never translated. */
  expr: string;
  threshold: number | null;
  unit: "percent" | "ms" | "count" | null;
  /** The latest reading. `null` is **no reading** — never zero, never "below threshold". */
  value: number | null;
  state: AlertState;
  /** ISO-8601, UTC. */
  openedAt: string;
  firedAt: string | null;
  resolvedAt: string | null;
  ackedAt: string | null;
  /** While this is in the future the alert is out of the default view but still open. */
  silencedUntil: string | null;
  /** How many evaluation passes have seen the condition still true. */
  occurrences: number;
  lastSeenAt: string;
};
