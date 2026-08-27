"use client";

import { TONE_FILL } from "@components/ui/surface";
import { Tooltip, TooltipBlock } from "@components/ui/Tooltip";
import { useCursorHover } from "@components/ui/useCursorHover";
import { formatDuration, formatValue } from "@lib/alertFormat";
import { cn } from "@lib/utils";
import { timeOfDay } from "@lib/zone";
import { useZone } from "@lib/zoneState";
import { ALERTS_TEXT } from "@text/alerts";

import type { Tone } from "@components/ui/surface";
import type { AlertRow, AlertState, AlertTransition } from "@lib/alertTypes";

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
 *
 * **Every one of those widths is a duration nothing on screen names.** The band is twelve pixels of
 * three colours over six hours, so "flapping every ten minutes since lunch" and "fired once at
 * 14:02" are two shapes a reader has to interpret by eye and cannot check. Under the pointer each
 * segment now says which state it is, when it started and ended, how long it lasted, and what the
 * alert was reading when it changed — which is the sentence the band was drawn to make.
 */

const STATE_TONE: Record<AlertState, Tone> = { pending: "warn", firing: "error", resolved: "ok" };

export const StateBand = ({
  transitions,
  from,
  to,
  unit,
}: {
  transitions: AlertTransition[];
  from: string;
  to: string;
  /** The alert's own unit, so a transition's reading is `3.1%` and not a bare `3.1`. */
  unit: AlertRow["unit"];
}) => {
  const { tz } = useZone();
  const { hover, move, clear } = useCursorHover<Segment>();

  const start = Date.parse(from);
  const end = Date.parse(to);
  const span = Math.max(1, end - start);

  if (transitions.length === 0) {
    return <p className="text-micro text-chassis-text-dim">{ALERTS_TEXT.historyEmpty}</p>;
  }

  // Each transition owns the stretch from where it happened to the next one, or to the window's
  // end. Clamped into the window: a transition on the boundary must not draw a negative width.
  const segments: Segment[] = transitions.map((transition, index) => {
    const at = Math.min(Math.max(Date.parse(transition.ts), start), end);
    const next = index + 1 < transitions.length ? Math.min(Date.parse(transitions[index + 1].ts), end) : end;

    return {
      key: `${transition.ts}-${transition.to}`,
      state: transition.to,
      at,
      /* The clamped end, which is the one the bubble may quote: a segment still running at the edge
         of the window ends *at the window*, and saying otherwise would report a transition that
         has not happened. */
      until: Math.max(at, next),
      value: transition.value,
      left: ((at - start) / span) * 100,
      width: (Math.max(0, next - at) / span) * 100,
    };
  });

  return (
    <>
      {/* The leave is on the band, not on the segments: crossing from one state into the next fires
          a leave before the enter, and a bubble that closed between every pair would flicker its
          way along a flapping alert — the one this view exists to show. */}
      <div
        role="img"
        aria-label={ALERTS_TEXT.historyTitle}
        onMouseLeave={clear}
        className="relative h-3 w-full overflow-hidden rounded-chip bg-chassis-inset"
      >
        {segments.map((segment) => (
          /* biome-ignore lint/a11y/noStaticElementInteractions: a painted stretch inside a
             `role="img"`, not a control — the pointer is an extra way to read the band, and the
             modal around it prints the state, the reading and the duration in words regardless */
          <span
            key={segment.key}
            onMouseEnter={move(segment)}
            onMouseMove={move(segment)}
            className={cn("absolute inset-y-0", TONE_FILL.chassis[STATE_TONE[segment.state]])}
            style={{ left: `${segment.left}%`, width: `${segment.width}%` }}
          />
        ))}
      </div>

      <Tooltip
        mode="cursor"
        point={hover}
      >
        {hover ? (
          <TooltipBlock
            subject={ALERTS_TEXT.states[hover.data.state]}
            context={`${timeOfDay(new Date(hover.data.at).toISOString(), tz)} → ${timeOfDay(new Date(hover.data.until).toISOString(), tz)}`}
            rows={[
              { label: ALERTS_TEXT.bandRows.held, value: formatDuration(hover.data.until - hover.data.at) },
              /* The reading that caused the change, and only when there was one: a transition
                 recorded with no value is a state change the engine made on an absence, which is
                 not the same as one it made on a zero. */
              ...(hover.data.value === null
                ? []
                : [{ label: ALERTS_TEXT.bandRows.reading, value: formatValue(hover.data.value, unit) }]),
            ]}
          />
        ) : null}
      </Tooltip>
    </>
  );
};

/** One drawn stretch: which state, when it ran, and where it sits in the band. */
type Segment = {
  key: string;
  state: AlertState;
  at: number;
  until: number;
  value: number | null;
  left: number;
  width: number;
};
