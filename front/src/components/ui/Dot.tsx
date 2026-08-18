import { cn } from "@lib/utils";
import { TONE_FILL } from "./surface";

import type { Surface, Tone } from "./surface";

/**
 * The pastille — a state in six pixels.
 *
 * Always paired with a text label by its caller, never alone: colour is the whole of what this
 * conveys, and roughly one man in twelve cannot separate the red from the green. The `title`
 * carries the state in words for the same reason.
 */
export const Dot = ({
  tone,
  surface = "work",
  label,
  className,
}: {
  tone: Tone;
  surface?: Surface;
  label: string;
  className?: string;
}) => (
  <span
    role="img"
    aria-label={label}
    title={label}
    className={cn("inline-block size-1.5 rounded-full", TONE_FILL[surface][tone], className)}
  />
);
