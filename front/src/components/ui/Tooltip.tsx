import { cn } from "@lib/utils";
import { useId } from "react";

/**
 * A tooltip, on hover **and** focus.
 *
 * `group-focus-within` alongside `group-hover` is the whole accessibility of this component: a tip
 * that only appears under a pointer does not exist for anyone using a keyboard, which on a tool
 * navigated by `j`/`k` is most of the time.
 *
 * Wired with `aria-describedby` rather than left as decoration, so the text is announced instead of
 * merely drawn. Always the chassis surface: a tooltip overhangs whatever it explains, and §3.1 puts
 * everything that overhangs on the dark ramp regardless of what is underneath.
 *
 * CSS-only positioning — centred above, and clamped by nothing. That is honest for labels a few
 * words long, which is all this is for; anything that needs collision detection wants a popover and
 * a positioning library, and should say so rather than quietly growing out of this.
 */
export const Tooltip = ({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) => {
  const id = useId();

  return (
    <span className={cn("group relative inline-flex", className)}>
      <span
        aria-describedby={id}
        className="inline-flex"
      >
        {children}
      </span>
      <span
        id={id}
        role="tooltip"
        className={cn(
          "pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap",
          "rounded-chip border border-chassis-border-strong bg-chassis-raised px-1.5 py-0.5",
          "text-micro text-chassis-text shadow-menu",
          "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
        )}
      >
        {label}
      </span>
    </span>
  );
};
