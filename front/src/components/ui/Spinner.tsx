import { cn } from "@lib/utils";

/**
 * The pending spinner — IKN-57's second pass. The same fact as `Pending`, at a different distance.
 *
 * The mark counts three dots at 10px, which is legible at reading distance and invisible from
 * anywhere else — shipped alone, it drew the same complaint the ellipsis did: "I cannot see that
 * it is loading". This is the tile-scale answer. It says nothing the mark does not, which is why
 * the two always appear together and never apart: the spinner is how you notice, the mark is what
 * you read once you have.
 *
 * **Eight ticks with a baked-in opacity tail, and the whole SVG steps.** The gradient is drawn
 * once, into the geometry; `--animate-pending-spin` rotates it 45° at a time, so the bright tick
 * lands exactly where its neighbour was and the dial appears to advance while every element holds
 * still. One compositor-friendly transform instead of eight animated opacities — and stepping
 * rather than gliding, because every motion in Iknos is a discrete state change and a smoothly
 * sweeping arc would be the one thing on screen that flows.
 *
 * **No ink of its own.** `stroke="currentColor"` throughout: the caller's colour is the spinner's,
 * same rule as `Pending`. `SignalTile` sets `text-work-text-dim` — present without shouting, on a
 * panel someone may be staring at while something is wrong.
 *
 * `aria-hidden`, always: the region it decorates already carries `aria-busy`, and the mark beside
 * it says the same thing in real words. A spinner is punctuation.
 */
const TICKS = [1, 0.85, 0.7, 0.55, 0.4, 0.3, 0.2, 0.12];

export const Spinner = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    aria-hidden="true"
    className={cn("size-6 animate-pending-spin", className)}
  >
    {TICKS.map((opacity, i) => (
      <line
        key={opacity}
        x1="12"
        y1="3.5"
        x2="12"
        y2="8"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity={opacity}
        /* Clockwise from twelve, brightest first — the direction a reader expects time to run. */
        transform={`rotate(${i * 45} 12 12)`}
      />
    ))}
  </svg>
);
