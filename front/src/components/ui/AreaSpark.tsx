import { cn } from "@lib/utils";
import { areaOf, layoutOf, pointsOf } from "./series";
import { TONE_TEXT } from "./surface";

import type { SeriesValue } from "./series";
import type { Surface, Tone } from "./surface";

/**
 * A filled area under a line — the throughput tile (IKN-13, design doc §5.2).
 *
 * An area rather than a plain line because the question the tile answers is *how much*, not *what
 * shape*: the fill is the quantity, and it is drawn from **zero** rather than from the series'
 * own minimum for exactly that reason. A relative baseline would make a service serving one request
 * a minute and a service serving a thousand look identical.
 *
 * **Gaps stay gaps.** A `null` point is an interval that cannot be quoted, and each unbroken
 * stretch is drawn as its own path — an area continuing under a hole would be claiming volume for
 * time nobody measured. That is the same rule `Sparkline` follows and the same one the log
 * histogram's zero-fill exists to make possible.
 *
 * Both the line and the fill are `currentColor`, so the tone arrives as text colour through
 * `TONE_TEXT` and is governed by the same contrast gate as everything else.
 */
export const AreaSpark = ({
  values,
  tone = "ok",
  surface = "work",
  width = 120,
  height = 26,
  label,
  className,
}: {
  values: SeriesValue[];
  tone?: Tone;
  surface?: Surface;
  width?: number;
  height?: number;
  label: string;
  className?: string;
}) => {
  const layout = layoutOf(values, width, height, "zero");
  // Nothing known at all: the caller says why in words. Returning `null` is what makes "absent, not
  // faked" true at the component level rather than only in the caller's intentions.
  if (layout.runs.length === 0) return null;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
      className={cn("block h-full w-full overflow-visible", TONE_TEXT[surface][tone], className)}
    >
      {layout.runs.map((run) =>
        run.values.length > 1 ? (
          <g key={run.start}>
            {/* No `vectorEffect` on the fill: it is a stroke-only property, and the area is meant
                to stretch with the box. */}
            <path
              d={areaOf(run, layout)}
              fill="currentColor"
              fillOpacity={0.22}
            />
            <polyline
              points={pointsOf(run, layout)}
              fill="none"
              stroke="currentColor"
              strokeWidth={1}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ) : (
          /* A lone reading has no segment to draw, and a `<polyline>` of one point renders nothing
             at all. On a sparsely scraped service that is most of the series, so it gets a dot: the
             reading exists and the chart should not silently swallow it. */
          <circle
            key={run.start}
            cx={layout.x(run.start)}
            cy={layout.y(run.values[0])}
            r={1}
            fill="currentColor"
          />
        ),
      )}
    </svg>
  );
};
