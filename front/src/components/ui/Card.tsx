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
 *
 * **The body's padding is a default, not a law** — `bodyClassName` replaces it (IKN-14). The fixed
 * `p-3` is right for a card holding fields and wrong for one holding a list: the issues rail is
 * rows that run flush to the card's edges and scroll inside it, which needs both `p-0` and the
 * `min-h-0 flex-1 overflow-y-auto` that makes the *body* the scrolling child rather than the page.
 * Handed the whole class string rather than a `bare` boolean, because those are two independent
 * decisions and a caller wanting flush edges almost always wants the scroll rule with them.
 *
 * ⚠️ **The `...rest` onto the `<section>` is load-bearing, and its absence was invisible.** The demo
 * film addresses cards by `data-testid`, and TypeScript exempts hyphenated JSX attributes from
 * excess-property checking — so `<Card data-testid="alerts-panel">` compiled clean against a closed
 * props object and dropped the attribute at runtime. A green build, and nothing in the DOM. The
 * same spread, for the same reason, is on every other primitive in this directory.
 */
export const Card = ({
  surface = "work",
  title,
  kicker,
  actions,
  className,
  bodyClassName,
  bodyTestid,
  children,
  ...rest
}: {
  surface?: Surface;
  title?: string;
  kicker?: string;
  actions?: React.ReactNode;
  className?: string;
  /** Replaces the body's `p-3` outright — see the note above. */
  bodyClassName?: string;
  /**
   * A name for the body — which is the scroller wherever `bodyClassName` makes it one, and the
   * element nothing else can reach. A `data-testid` handed to the card lands on the `<section>`,
   * and a wheel aimed there scrolls nothing; the alerts and issues rails both scroll on this div,
   * so it gets a name of its own, per call site, rather than one shared id on a shared component.
   */
  bodyTestid?: string;
  children: React.ReactNode;
  // `title` is omitted from the section's own attributes: here it is the heading, not the native
  // tooltip, and it never reaches the element.
} & Omit<React.ComponentPropsWithRef<"section">, "title">) => (
  <section
    className={cn("rounded-card border", SURFACE_BG[surface], SURFACE_BORDER[surface], className)}
    {...rest}
  >
    {(title || actions) && (
      <header className={cn("flex items-baseline gap-2 border-b px-3 py-2", SURFACE_BORDER[surface])}>
        {title && <h3 className={cn("font-sans text-ui font-medium", SURFACE_TEXT[surface])}>{title}</h3>}
        {kicker && (
          <span className={cn("text-kicker tracking-kicker uppercase", SURFACE_TEXT_DIM[surface])}>{kicker}</span>
        )}
        {actions && <div className="ml-auto flex items-center gap-1.5">{actions}</div>}
      </header>
    )}
    <div
      className={bodyClassName ?? "p-3"}
      data-testid={bodyTestid}
    >
      {children}
    </div>
  </section>
);
