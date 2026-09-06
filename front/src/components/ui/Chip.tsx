"use client";

import { cn } from "@lib/utils";
import { SURFACE_BORDER_STRONG, SURFACE_INSET_BG, SURFACE_TEXT, SURFACE_TEXT_DIM } from "./surface";

import type { Surface } from "./surface";

/**
 * A filter token — `service:pfa-api`, `level:≥warn`.
 *
 * The key is dimmed and the value is not, so a row of tokens scans as a list of values with their
 * fields attached rather than as a wall of `key:value`. Removal is a real button inside the chip:
 * a whole-chip click that removes it makes the chip unclickable for anything else later, and the
 * query bar will want that click for editing.
 */
export const Chip = ({
  label,
  value,
  surface = "work",
  onRemove,
  className,
  ...rest
}: {
  label: string;
  value: string;
  surface?: Surface;
  onRemove?: () => void;
  className?: string;
  // The spread is what lets a `data-testid` and a `data-filter` companion reach the token — see `Card`.
} & React.ComponentPropsWithRef<"span">) => (
  <span
    className={cn(
      "inline-flex items-center gap-1 rounded-chip border px-1.5 py-0.5 text-row",
      SURFACE_INSET_BG[surface],
      SURFACE_BORDER_STRONG[surface],
      className,
    )}
    {...rest}
  >
    <span className={SURFACE_TEXT_DIM[surface]}>{label}:</span>
    <span className={SURFACE_TEXT[surface]}>{value}</span>
    {onRemove && (
      /* Named, because its accessible name is `Remove {label} {value}` — it changes with every
         token, so a storyboard scopes to the chip and asks for this rather than for a label. */
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label} ${value}`}
        data-testid="chip-remove"
        className={cn(
          "ml-0.5 leading-none transition-[filter] duration-150 ease-out hover:brightness-125",
          SURFACE_TEXT_DIM[surface],
        )}
      >
        ×
      </button>
    )}
  </span>
);
