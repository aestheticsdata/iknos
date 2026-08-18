import { cn } from "@lib/utils";
import { TONE_TEXT } from "./surface";

import type { Surface, Tone } from "./surface";

/**
 * The 20-point sparkline the service rail and the ingest card need in M1 — the one dataviz
 * primitive that does not wait for IKN-13.
 *
 * **Renders nothing at all for an empty series.** Not a flat line, not a zero baseline: the rail's
 * whole rule is that a service nobody has probed shows no trace rather than a reassuring straight
 * line, and the contract leaves the field out of the payload for exactly that reason. Returning
 * `null` here is what makes "absent, not faked" true at the component level rather than only in
 * the caller's intentions.
 *
 * `stroke="currentColor"` so the tone comes from the text colour — the same four tokens the rest
 * of the ramp uses, and the same ones `pnpm run contrast` holds to AA.
 */
export const Sparkline = ({
  values,
  tone = "neutral",
  surface = "work",
  width = 60,
  height = 16,
  label,
  className,
}: {
  values: number[];
  tone?: Tone;
  surface?: Surface;
  width?: number;
  height?: number;
  label: string;
  className?: string;
}) => {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat series has no range to divide by. Drawing it down the middle is the truthful picture —
  // the alternative is a division by zero that renders the whole path as `NaN` and silently
  // disappears, which looks identical to having no data.
  const span = max - min || 1;
  const stepX = width / (values.length - 1);

  // 1px inset top and bottom: a value at the extreme would otherwise be clipped in half by the
  // viewBox, and a sparkline whose peaks are shaved is a sparkline that understates its spikes.
  const usable = height - 2;
  const points = values
    .map((value, index) => {
      const x = index * stepX;
      const y = 1 + usable - ((value - min) / span) * usable;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
      className={cn("overflow-visible", TONE_TEXT[surface][tone], className)}
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
};
