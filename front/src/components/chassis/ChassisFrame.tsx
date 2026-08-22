"use client";

import { cn } from "@lib/utils";
import { zoneFlashClass } from "@lib/zoneFlash";
import { useZone } from "@lib/zoneState";

/**
 * The chassis's layout box, and the one element the zone flash is played on — IKN-47.
 *
 * `h-dvh` with `overflow-hidden` is the layout rule from the design doc, unchanged: the screen
 * fits 1440×900 without a page scrollbar and only the lists inside it scroll. What is new is that
 * this box now has a reason to be a client component, and it is worth being precise about why,
 * because a client boundary around the whole chassis looks like a mistake at a glance.
 *
 * It is not a boundary around the chassis. `AppChassis` stays a server component and still reads
 * the registry; everything below still arrives as `children`, already rendered, and is passed
 * through untouched. This component renders one `<div>` and subscribes to one number.
 *
 * That div has to be here rather than in `AppChassis` for a plain reason: `AppChassis` is the
 * component that *mounts* `ZoneProvider`, so it cannot call `useZone()` itself — a provider is not
 * in scope for the component rendering it. And the div has to be the one carrying the animation
 * because it is the nearest common ancestor of everything that shows a time: the top bar's clock,
 * the rail's storage line, the log stream, the histogram's axis.
 *
 * ⚠️ Anything rendered through a portal — the ⌘K palette, the toasts — sits outside this box and
 * does not inherit `--ik-flash`. Neither shows a timestamp today. Whichever one does first will
 * need to play the animation itself.
 */
export const ChassisFrame = ({ children }: { children: React.ReactNode }) => {
  const { pulse } = useZone();

  return (
    <div
      className={cn(
        "flex h-dvh flex-col overflow-hidden bg-chassis-deep font-mono",
        /*
         * Nothing until the toggle has been pressed once, then a different name on every press —
         * `zoneFlashClass` holds both rules and is the one piece of this gesture a test can reach.
         */
        zoneFlashClass(pulse),
      )}
    >
      {children}
    </div>
  );
};
