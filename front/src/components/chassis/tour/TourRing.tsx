import { cn } from "@lib/utils";

import type { TourRingProps } from "./interfaces/tourRingTypes";

/** How far outside the control the ring is drawn, so it frames the control instead of tracing it. */
const PAD = 4;

/** The ring around the control a tour step is about. Decoration: it takes no click and no focus. */
export const TourRing = ({ anchor, leaving }: TourRingProps) => (
  <div
    aria-hidden="true"
    className={cn(
      "pointer-events-none fixed z-48 rounded-control border-2 border-chassis-accent",
      "transition-[left,top,width,height,opacity] duration-200 ease-out starting:opacity-0",
      leaving && "opacity-0",
    )}
    style={{
      left: anchor.x - PAD,
      top: anchor.y - PAD,
      width: anchor.width + PAD * 2,
      height: anchor.height + PAD * 2,
    }}
    data-testid="tour-ring"
  />
);
