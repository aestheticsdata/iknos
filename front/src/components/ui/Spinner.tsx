import { cn } from "@lib/utils";

/**
 * The pending spinner — IKN-57. The same fact as `Pending`, at a different distance.
 *
 * The mark counts three dots at 10px, which is legible at reading distance and invisible from
 * anywhere else — shipped alone, it drew the same complaint the ellipsis did: "I cannot see that
 * it is loading". This is the tile-scale answer. It says nothing the mark does not, which is why
 * the two always appear together and never apart: the ring is how you notice, the mark is what you
 * read once you have.
 *
 * **A track and one arc, and that is the whole drawing.** The first cut of this was eight ticks
 * with an opacity tail, stepping 45° at a time — the throbber every OS shipped in 2005, and it was
 * rejected on sight for looking exactly like one. What dates that shape is its spokes: eight
 * discrete marks make the reader count them, and counting is what the dots below are already for.
 * A single arc on a faint ring has nothing to count. It is the shape every current interface has
 * converged on for the same reason, and the round cap is most of why it reads as drawn rather than
 * as rendered.
 *
 * **It glides, and that is a considered exception rather than a lapse.** `animations.css` opens on
 * the rule that motion which is not reporting a change is noise, and everything else here is a
 * state passing into another state — a flash, a fold, a dialog landing. Waiting is not a state
 * change. It is a duration, and the honest shape for a duration is continuous: a ring that ticks
 * would be claiming discrete progress it does not have, which on a monitoring panel is a lie about
 * data. `ikPulse` is already `ease-in-out` for the same reason, so smooth motion is not foreign
 * here — it is what this file uses when the thing being reported has no steps in it.
 *
 * **0.9s, which is not the mark's 1.2s and does not want to be.** A full turn has to complete
 * inside the time a fast answer takes, or a 400ms response shows a twitch instead of a sweep and
 * reads as a glitch. The two are different kinds of motion and sharing a downbeat would buy nothing
 * anyone can see.
 *
 * **No ink of its own.** `currentColor` throughout: the caller's colour is the ring's, same rule as
 * `Pending`. `SignalTile` sets `text-work-text-dim` — present without shouting, on a panel someone
 * may be staring at while something is wrong.
 *
 * `aria-hidden`, always: the region it decorates already carries `aria-busy`, and the mark beside
 * it says the same thing in real words. A spinner is punctuation.
 */
export const Spinner = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    className={cn("size-6 animate-pending-spin", className)}
  >
    {/* The track. Faint enough to read as the space the arc travels through rather than as a second
        mark, and present because an arc alone on a busy tile has no circle to be an arc OF. */}
    <circle
      cx="12"
      cy="12"
      r="9"
      stroke="currentColor"
      strokeOpacity="0.15"
      strokeWidth="2"
    />
    {/* `pathLength="100"` makes the dash array a percentage of the circumference rather than a
        length in user units, so the arc stays 26% of the ring at any size the caller renders this
        at — `size-6` here, larger anywhere it is ever needed. Started at twelve o'clock, because a
        sweep that begins at three reads as already half done. */}
    <circle
      cx="12"
      cy="12"
      r="9"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      pathLength="100"
      strokeDasharray="26 74"
      transform="rotate(-90 12 12)"
    />
  </svg>
);
