import { cn } from "@lib/utils";
import { SURFACE_BG, SURFACE_BORDER, SURFACE_TEXT, SURFACE_TEXT_DIM } from "./surface";

import type { Surface } from "./surface";

/**
 * A card — **1px border and a flat fill, never a shadow**.
 *
 * §3.1 reserves elevation for what genuinely overhangs: modals, the user menu, toasts. A dashboard
 * where every panel floats has no way left to say "this one is on top of the others", which is the
 * only thing a shadow is for.
 *
 * The title is IBM Plex Sans; everything inside a card is data, and data is mono.
 */
export const Card = ({
  surface = "work",
  title,
  kicker,
  actions,
  className,
  children,
}: {
  surface?: Surface;
  title?: string;
  kicker?: string;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) => (
  <section className={cn("rounded-card border", SURFACE_BG[surface], SURFACE_BORDER[surface], className)}>
    {(title || actions) && (
      <header className={cn("flex items-baseline gap-2 border-b px-3 py-2", SURFACE_BORDER[surface])}>
        {title && <h3 className={cn("font-sans text-ui font-medium", SURFACE_TEXT[surface])}>{title}</h3>}
        {kicker && (
          <span className={cn("text-kicker tracking-kicker uppercase", SURFACE_TEXT_DIM[surface])}>{kicker}</span>
        )}
        {actions && <div className="ml-auto flex items-center gap-1.5">{actions}</div>}
      </header>
    )}
    <div className="p-3">{children}</div>
  </section>
);
