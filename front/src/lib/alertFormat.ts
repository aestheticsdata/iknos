import { ABSENT } from "@lib/serviceFormat";

import type { Tone } from "@components/ui/surface";
import type { AlertRow, Severity } from "@lib/alertTypes";

/**
 * The arithmetic the alert surfaces do at render time (IKN-15).
 *
 * Out here for the reason `serviceFormat.ts` gives: these are the decisions that would be wrong in
 * silence — a severity painted the wrong colour, a duration that rounds an hour to a day, a `0`
 * drawn where the answer is "nobody knows". None of them fails, and all of them are read as facts.
 */

/**
 * Severity → tone.
 *
 * `info` is the info tone and not the neutral one: an info alert is still an alert, and painting
 * it as chrome would make the only three-level scale in the product a two-level one.
 */
export const SEVERITY_TONE: Record<Severity, Tone> = {
  critical: "error",
  warning: "warn",
  info: "info",
};

/**
 * `00:04:12` — the mockup's own spelling for how long an alert has been open.
 *
 * Hours are kept even at zero, because the field is read as a clock and a row that switched between
 * `04:12` and `01:04:12` would change width under the reader. Past a day it says days, since at
 * that point the seconds are noise and the only question is how long this has been ignored.
 */
export const formatDuration = (ms: number): string => {
  if (!Number.isFinite(ms) || ms < 0) return ABSENT;

  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86_400);
  if (days > 0) return `${days}d ${String(Math.floor((total % 86_400) / 3600)).padStart(2, "0")}h`;

  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
};

/**
 * How long this alert has been going, from the moment that started it.
 *
 * `firedAt` when it has fired, `openedAt` while it is still pending — the two are different
 * questions and the badge beside this says which one is being answered.
 */
export const openFor = (alert: AlertRow, now: number): number => {
  const since = alert.state === "pending" ? alert.openedAt : (alert.firedAt ?? alert.openedAt);
  const at = Date.parse(since);
  return Number.isNaN(at) ? 0 : Math.max(0, now - at);
};

/**
 * The reading, in its own unit — `3.1%`, `1204ms`, `2`.
 *
 * **`—` for a null**, and that is the whole reason this is a function. A null value is a reading
 * that was not taken; rendering it as `0` would state that the thing being watched was measured
 * and found clean, which is the one lie a monitoring tool must not tell.
 */
export const formatValue = (value: number | null, unit: AlertRow["unit"]): string => {
  if (value === null || !Number.isFinite(value)) return ABSENT;

  const number = Math.abs(value) < 10 ? Number(value.toFixed(1)) : Math.round(value);
  switch (unit) {
    case "percent":
      return `${number}%`;
    case "ms":
      return `${number}ms`;
    default:
      return String(number);
  }
};

/**
 * Whether an alert is one the reader is being asked to do something about.
 *
 * The same predicate the API's `needsAttention` fragment applies, restated here for the one thing
 * the server cannot do: hide a row the reader has just acknowledged, in the frame they clicked it.
 * The two must agree, which is why this comment names the other one.
 */
export const needsAttention = (alert: AlertRow, now: number): boolean =>
  alert.resolvedAt === null &&
  alert.state === "firing" &&
  alert.ackedAt === null &&
  (alert.silencedUntil === null || Date.parse(alert.silencedUntil) <= now);
