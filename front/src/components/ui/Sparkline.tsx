"use client";

import { cn } from "@lib/utils";
import { layoutOf, pointIndexAt, pointsOf } from "./series";
import { TONE_TEXT } from "./surface";
import { Tooltip } from "./Tooltip";
import { useCursorHover } from "./useCursorHover";

import type { MouseEvent, ReactNode } from "react";
import type { SeriesValue } from "./series";
import type { Surface, Tone } from "./surface";

/**
 * A line, at any size — the rail's twenty points, the ingest card's hour, and the p95 tile.
 *
 * **Renders nothing at all for an empty series.** Not a flat line, not a zero baseline: the rail's
 * whole rule is that a service nobody has probed shows no trace rather than a reassuring straight
 * line, and the contract leaves the field out of the payload for exactly that reason. Returning
 * `null` here is what makes "absent, not faked" true at the component level rather than only in
 * the caller's intentions.
 *
 * Since IKN-13 it also understands **holes**. A `null` point is an interval that could not be
 * quoted, and each unbroken stretch is drawn as its own polyline — one line walking across the gap
 * would join two real measurements with a segment that was never measured, which is the most
 * confident thing a chart can draw and the least true.
 *
 * The scale is the series' own, deliberately: this is the *shape* primitive, and a p95 that sits
 * between 405ms and 412ms all day is a flat line on the floor against a zero baseline, with every
 * bit of the variation a reader is looking for lost in the bottom pixel. `AreaSpark` is the one
 * that starts at zero, because there the quantity is the point.
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
  reference,
  label,
  tip,
  className,
}: {
  values: SeriesValue[];
  tone?: Tone;
  surface?: Surface;
  width?: number;
  height?: number;
  /**
   * A horizontal rule at one value, in the series' own units — the reference mark §5.2 asks the p95
   * tile for.
   *
   * It has to *reference* something the reader can name, which is why it is a value and not a
   * position: the mockup's dash sits at a fixed y and refers to nothing at all. The p95 tile passes
   * the figure in its own headline, so the curve is read against the window's overall percentile —
   * every interval above the line is worse than the range as a whole.
   */
  reference?: number | null;
  label: string;
  /**
   * What the reading at `index` says under the pointer, or nothing for an interval that cannot be
   * quoted. The caller writes it, because the caller is the only one that knows what the series is
   * an axis of — see `BarSpark`, which takes the same prop for the same reason.
   */
  tip?: (index: number) => ReactNode;
  className?: string;
}) => {
  /* Before the early return below, because hooks cannot run conditionally. */
  const { hover, show, clear } = useCursorHover<number>();

  const layout = layoutOf(values, width, height, "min");
  if (layout.runs.length === 0) return null;

  /*
   * Only drawn where it lands inside the series it is meant to be read against.
   *
   * `layout.y` extrapolates past the ends, and the box is `overflow-visible`, so a reference above
   * the highest point would be painted across the tile above this one. A rule outside the chart's
   * own range also has nothing to say — every point is on the same side of it — so the honest
   * rendering of that is no rule at all.
   *
   * The flat-series branch is the same question in a different shape: `layout.y` returns one
   * position for every value there, so a rule would sit exactly on the line and claim a coincidence
   * that is only an artefact.
   */
  const rule =
    reference != null &&
    Number.isFinite(reference) &&
    layout.max > layout.min &&
    reference >= layout.min &&
    reference <= layout.max
      ? layout.y(reference)
      : null;

  /*
   * Nearest *point*, not nearest slot — a line's marks are positions, and the reader following a
   * curve is pointing at a vertex. One listener on the box, so the 1px stroke is not the only
   * thing that answers.
   */
  const track = (event: MouseEvent<SVGSVGElement>) =>
    show(
      event.clientX,
      event.clientY,
      pointIndexAt(event.clientX, event.currentTarget.getBoundingClientRect(), values.length),
    );

  return (
    <>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label={label}
        preserveAspectRatio="none"
        onMouseLeave={tip ? clear : undefined}
        onMouseMove={tip ? track : undefined}
        className={cn("overflow-visible", TONE_TEXT[surface][tone], className)}
      >
        {rule !== null && (
          /* The same ink as the line, faded — a second colour here would be a second thing to read,
           and the rule is a datum rather than a series. */
          <line
            x1={0}
            y1={rule}
            x2={width}
            y2={rule}
            stroke="currentColor"
            strokeOpacity={0.4}
            strokeWidth={1}
            strokeDasharray="2 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {layout.runs.map((run) =>
          run.values.length > 1 ? (
            <polyline
              key={run.start}
              points={pointsOf(run, layout)}
              fill="none"
              stroke="currentColor"
              strokeWidth={1}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ) : (
            /* A `<polyline>` of one point renders nothing at all. On a sparsely scraped service that
             is most of the series, so a lone reading gets a dot rather than being swallowed. */
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
      {tip ? (
        <Tooltip
          mode="cursor"
          point={hover}
        >
          {hover ? tip(hover.data) : null}
        </Tooltip>
      ) : null}
    </>
  );
};
