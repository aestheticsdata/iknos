import { cn } from "@lib/utils";
import { SURFACE_INSET_BG, TONE_FILL } from "./surface";

import type { Surface, Tone } from "./surface";

/**
 * A track and a fill — the runtime tile's event-loop and pool rows (IKN-13, design doc §5.2).
 *
 * Not an SVG. It is two nested boxes and a width, which is what the storage panel already draws
 * inline; this is that shape given a name so the two cannot drift apart, and given a `tone` so the
 * pool bar can turn red at saturation — the scenario the mockup was built around.
 *
 * **`aria-hidden`, and that is deliberate.** The figure is always rendered beside it by the caller,
 * so a screen reader announcing "seventy-two percent" and then "10/10 · 2 waiting" reports one fact
 * twice, in two units, and neither is the one that was asked for. The bar is a way of seeing the
 * number at a glance, not a second copy of it.
 */
export const MeterBar = ({
  share,
  tone = "ok",
  surface = "work",
  className,
}: {
  /** 0–1. Clamped, because a gauge that overflows its own track is a rendering fault, not a reading. */
  share: number;
  tone?: Tone;
  surface?: Surface;
  className?: string;
}) => {
  const filled = Math.min(1, Math.max(0, Number.isFinite(share) ? share : 0));

  return (
    <span
      aria-hidden="true"
      className={cn("h-1 flex-1 overflow-hidden rounded-full", SURFACE_INSET_BG[surface], className)}
    >
      <span
        className={cn(
          "block h-full transition-[width,background-color] duration-150 ease-out",
          TONE_FILL[surface][tone],
        )}
        /*
         * A percentage of a parent's width is the one thing that cannot be a class here: the value
         * is data, and a class built from it is a class Tailwind's scanner never sees and never
         * emits. `StoragePanel` takes the same exception for the same reason.
         *
         * The floor of one percent is so that a small non-zero reading is a sliver rather than
         * nothing — "almost none" and "none" are different answers.
         */
        style={{ width: `${filled === 0 ? 0 : Math.max(filled * 100, 1)}%` }}
      />
    </span>
  );
};
