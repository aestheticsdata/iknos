"use client";

import { Dot } from "@components/ui/Dot";
import { ageOfPoll, HEALTH_TONE, healthOf } from "@lib/collectorTypes";
import { formatLag } from "@lib/format";
import { useCollectorStatus } from "@lib/useCollector";
import { CHASSIS_TEXT } from "@text/chassis";

/**
 * `● collector · lag 0.4s` — the top bar's pastille (IKN-24).
 *
 * **The only place in the whole interface where "the collector has stopped" is visible.** Every
 * other surface degrades quietly when ingestion dies: the log panel simply shows nothing new,
 * which is indistinguishable from a quiet afternoon. This is the one thing on screen that knows
 * the difference, which is why it lives in permanent chrome rather than behind a view.
 *
 * The dot pulses only while the collector is healthy. A red dot that throbs looks like an
 * animation someone left running; a green one that does is the visual difference between "this
 * number is live" and "this number is the last thing I heard".
 */
export const CollectorPill = () => {
  const { status, receivedAt, now } = useCollectorStatus();
  const health = healthOf(status, receivedAt, now);

  /*
   * `unknown` shows the word and no number at all — never `lag 0ms`.
   *
   * This is the whole degradation rule of the ticket in one branch. A cold start has written
   * nothing and measured nothing, and a zero there reads as "keeping up perfectly" at exactly the
   * moment nothing is being collected. The absence of a figure is the honest report, and the
   * title says which of the two silences this is.
   */
  const lag = health === "unknown" || status?.lagMs === null ? null : formatLag(status?.lagMs ?? 0);
  const age = status === null ? null : ageOfPoll(status, receivedAt, now);

  return (
    <span
      className="flex items-center gap-1.5 text-kicker tracking-control text-chassis-text-dim"
      title={hint(health, age)}
    >
      <Dot
        surface="chassis"
        tone={HEALTH_TONE[health]}
        // The label is the state in words — the dot is six pixels of colour, and roughly one man
        // in twelve cannot read the red from the green.
        label={CHASSIS_TEXT.collectorState[health]}
        className={health === "ok" ? "animate-pulse-live" : undefined}
      />
      <span className="text-chassis-text-muted">{CHASSIS_TEXT.collector}</span>
      {lag !== null ? (
        <span className="tabular-nums">
          {CHASSIS_TEXT.lag} {lag}
        </span>
      ) : (
        <span>{CHASSIS_TEXT.collectorState[health]}</span>
      )}
    </span>
  );
};

/**
 * What the pastille says when pointed at.
 *
 * Spells out the heartbeat's age rather than repeating the lag: lag answers "how far behind is the
 * pipeline", and the question somebody hovering a red dot is actually asking is "how long has it
 * been like this".
 */
const hint = (health: "unknown" | "ok" | "warn" | "down", ageMs: number | null): string => {
  if (health === "unknown") return CHASSIS_TEXT.collectorUnknownHint;
  if (ageMs === null) return CHASSIS_TEXT.collectorState[health];
  return CHASSIS_TEXT.collectorHint(CHASSIS_TEXT.collectorState[health], formatLag(ageMs));
};
