import { cn } from "@lib/utils";
import { useId } from "react";
import { SURFACE_BORDER_STRONG, SURFACE_INSET_BG, SURFACE_TEXT, SURFACE_TEXT_DIM } from "./surface";

import type { Surface } from "./surface";

/**
 * A labelled input.
 *
 * `useId` rather than a required `id` prop: a label that is not wired to its input still *looks*
 * correct, so the mistake survives review and only shows up for someone navigating by keyboard.
 * Generating it removes the chance to get it wrong.
 *
 * The hint slot doubles as the error slot, and an error sets `aria-invalid` with
 * `aria-describedby` pointing at it — the message has to reach a screen reader, not just the eye.
 * The auth screens keep their own `AuthField`: it carries reveal toggles and a strength meter that
 * nothing else needs.
 */
export const Field = ({
  label,
  hint,
  error,
  surface = "work",
  className,
  ...props
}: React.ComponentPropsWithRef<"input"> & {
  label: string;
  hint?: string;
  error?: string;
  surface?: Surface;
}) => {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label
        htmlFor={id}
        className={cn("text-kicker tracking-kicker uppercase", SURFACE_TEXT_DIM[surface])}
      >
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={note ? noteId : undefined}
        className={cn(
          "h-7 rounded-control border px-2 text-ui outline-none",
          SURFACE_INSET_BG[surface],
          SURFACE_TEXT[surface],
          error ? "border-work-error" : SURFACE_BORDER_STRONG[surface],
          surface === "chassis" ? "focus:border-chassis-border-focus" : "focus:border-work-text-muted",
        )}
        {...props}
      />
      {note && (
        <p
          id={noteId}
          className={cn("text-micro", error ? "text-work-error" : SURFACE_TEXT_DIM[surface])}
        >
          {note}
        </p>
      )}
    </div>
  );
};
