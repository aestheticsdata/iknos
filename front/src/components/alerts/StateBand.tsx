"use client";

import { TONE_FILL } from "@components/ui/surface";
import { cn } from "@lib/utils";
import { ALERTS_TEXT } from "@text/alerts";

import type { Tone } from "@components/ui/surface";
import type { AlertState, AlertTransition } from "@lib/alertTypes";

/**
 * What the alert's state has been across the window — IKN-15 §2.
 *
 * **This is the whole reason `alert_state_change` is a table.** Without it a modal can say
 * "firing, since 14:02" and nothing else, which says nothing at all about an alert that has been
 * flapping every ten minutes since lunch — and telling those two apart is the only question this
 * band answers.
 *
 * Drawn from transitions rather than from samples: each one starts a segment that runs until the
 * next, so a quiet stretch is one wide block rather than four hundred identical marks. The window
 * before the first transition is the state the alert was in when the window opened, which is
 * `pending` at worst and is drawn as the neutral ground rather than guessed at.
 */

const STATE_TONE: Record<AlertState, Tone> = { pending: "warn", firing: "error", resolved: "ok" };

export const StateBand = ({ transitions, from, to }: { transitions: AlertTransition[]; from: string; to: string }) => {
  const start = Date.parse(from);
  const end = Date.parse(to);
  const span = Math.max(1, end - start);

  if (transitions.length === 0) {
    return <p className="text-micro text-chassis-text-dim">{ALERTS_TEXT.historyEmpty}</p>;
  }

  // Each transition owns the stretch from where it happened to the next one, or to the window's
  // end. Clamped into the window: a transition on the boundary must not draw a negative width.
  const segments = transitions.map((transition, index) => {
    const at = Math.min(Math.max(Date.parse(transition.ts), start), end);
    const next = index + 1 < transitions.length ? Math.min(Date.parse(transitions[index + 1].ts), end) : end;

    return {
      key: `${transition.ts}-${transition.to}`,
      state: transition.to,
      left: ((at - start) / span) * 100,
      width: (Math.max(0, next - at) / span) * 100,
    };
  });

  return (
    <div
      role="img"
      aria-label={ALERTS_TEXT.historyTitle}
      className="relative h-3 w-full overflow-hidden rounded-chip bg-chassis-inset"
    >
      {segments.map((segment) => (
        <span
          key={segment.key}
          className={cn("absolute inset-y-0", TONE_FILL.chassis[STATE_TONE[segment.state]])}
          style={{ left: `${segment.left}%`, width: `${segment.width}%` }}
        />
      ))}
    </div>
  );
};
