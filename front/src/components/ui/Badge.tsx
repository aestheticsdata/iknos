import { cn } from "@lib/utils";
import { SURFACE_BORDER_STRONG, TONE_TEXT } from "./surface";

import type { Surface, Tone } from "./surface";

/**
 * A state badge — level names, health, counts.
 *
 * Text-coloured on a hairline border rather than a filled block: a row of solid colour chips reads
 * as decoration, and at 9px a filled badge has to choose between a legible foreground and the tone
 * being recognisable. The tone lives in the text, which `pnpm run contrast` holds to 4.5:1.
 */
export const Badge = ({
  tone = "neutral",
  surface = "work",
  className,
  children,
}: {
  tone?: Tone;
  surface?: Surface;
  className?: string;
  children: React.ReactNode;
}) => (
  <span
    className={cn(
      "inline-flex items-center rounded-chip border px-1.5 py-0.5 text-kicker tracking-kicker uppercase",
      SURFACE_BORDER_STRONG[surface],
      TONE_TEXT[surface][tone],
      className,
    )}
  >
    {children}
  </span>
);
