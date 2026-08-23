import { cn } from "@lib/utils";
import { useId } from "react";
import { SURFACE_BORDER_STRONG, SURFACE_INSET_BG, SURFACE_TEXT, SURFACE_TEXT_DIM } from "./surface";

import type { Surface } from "./surface";

export type Option = { value: string; label: string };

/**
 * A labelled select, on the native element.
 *
 * Not a custom listbox: the native control brings type-ahead, keyboard semantics and the platform's
 * own overlay on every device, and a hand-rolled replacement gets those wrong in ways that only
 * show up for someone who does not use a mouse. What is styled here is the closed state, which is
 * the only part on screen most of the time.
 *
 * `appearance-none` with a drawn caret rather than the platform arrow, because the platform arrow
 * is the one part of a select that cannot be made to match either ramp.
 */
export const Select = ({
  label,
  options,
  hint,
  surface = "work",
  className,
  ...props
}: Omit<React.ComponentPropsWithRef<"select">, "children"> & {
  label: string;
  options: Option[];
  hint?: string;
  surface?: Surface;
}) => {
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label
        htmlFor={id}
        className={cn("text-kicker tracking-kicker uppercase", SURFACE_TEXT_DIM[surface])}
      >
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          aria-describedby={hint ? hintId : undefined}
          className={cn(
            "h-7 w-full appearance-none rounded-control border pr-6 pl-2 text-ui outline-none transition-[border-color] duration-150 ease-out",
            SURFACE_INSET_BG[surface],
            SURFACE_TEXT[surface],
            SURFACE_BORDER_STRONG[surface],
            surface === "chassis" ? "focus:border-chassis-border-focus" : "focus:border-work-text-muted",
          )}
          {...props}
        >
          {options.map((option) => (
            <option
              key={option.value}
              value={option.value}
            >
              {option.label}
            </option>
          ))}
        </select>
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 right-2 flex items-center text-micro",
            SURFACE_TEXT_DIM[surface],
          )}
        >
          ▾
        </span>
      </div>
      {hint && (
        <p
          id={hintId}
          className={cn("text-micro", SURFACE_TEXT_DIM[surface])}
        >
          {hint}
        </p>
      )}
    </div>
  );
};
