"use client";

import { cn } from "@lib/utils";
import { barIndexAt } from "./series";
import { TONE_TEXT } from "./surface";
import { Tooltip } from "./Tooltip";
import { useCursorHover } from "./useCursorHover";

import type { MouseEvent, ReactNode } from "react";
import type { SeriesValue } from "./series";
import type { Surface, Tone } from "./surface";

/**
 * A bar per interval — the error-rate tile (IKN-13, design doc §5.2).
 *
 * Bars rather than a line because an error rate is not continuous: between two intervals there is
 * nothing to interpolate, and a line drawn through them invites the reader to believe the value
 * halfway between two bars means something. Each bar is one measurement of one interval.
 *
 * Its geometry follows `VolumeHistogram` rather than `Sparkline`: the box is `0 0 <count> <height>`
 * so that one vertical unit is one pixel and the *y* axis stays honest under
 * `preserveAspectRatio="none"`, while anything horizontal is a fraction of a bar.
 *
 * **Three states, three renderings**, which is the whole reason this is not four lines of flexbox:
 *
 * - a value above zero draws a bar in proportion to it;
 * - a measured **zero** draws a stub on the baseline, dimmed — the interval was watched and
 *   nothing failed, which is a fact and not an absence;
 * - a `null` draws **nothing**, because the interval could not be quoted.
 *
 * Collapsing the last two is how "the collector was down" becomes "no errors", which on this
 * particular tile is the most reassuring lie the product could tell.
 */

/** Fraction of a bar's slot left empty, so neighbours read as separate measurements. */
const BAR_GAP = 0.18;

/** What a measured zero gets, in user units, so that it is visible without reading as a value. */
const ZERO_STUB = 1;

export const BarSpark = ({
  values,
  tone = "error",
  surface = "work",
  height = 26,
  max,
  label,
  tip,
  className,
}: {
  values: SeriesValue[];
  tone?: Tone;
  surface?: Surface;
  height?: number;
  /**
   * The top of the scale.
   *
   * Passed in rather than taken from the series when the tile has a scale in mind — an error rate
   * is a percentage, and a chart of a single 0.4% blip normalised to full height reads as a
   * catastrophe. Omitted, the series sets its own top.
   */
  max?: number;
  label: string;
  /**
   * What the bar at `index` says under the pointer, or nothing — an interval nobody scraped has no
   * answer, and `null` there is a bar with no bubble rather than an empty one.
   *
   * The caller writes it because the caller owns the axis: this component is handed values and has
   * never been told what interval they cover. Omitted, the chart binds no handlers and holds no
   * state, which is what keeps it free everywhere a bar is decoration.
   */
  tip?: (index: number) => ReactNode;
  className?: string;
}) => {
  /* Before the early return below, because hooks cannot run conditionally. */
  const { hover, show, clear } = useCursorHover<number>();

  const known = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (known.length === 0) return null;

  const top = Math.max(max ?? 0, ...known) || 1;
  const usable = height - ZERO_STUB;

  /*
   * One listener on the `<svg>`, not one per `<rect>`. The bars are drawn with a gap between them
   * and half of them are a one-unit stub on the baseline, so per-rect handlers would leave most of
   * the chart's area unresponsive — the pointer would have to find a 2px sliver to get an answer.
   * The whole box is live, and which bar it is is arithmetic on the box's own width.
   */
  const track = (event: MouseEvent<SVGSVGElement>) =>
    show(
      event.clientX,
      event.clientY,
      barIndexAt(event.clientX, event.currentTarget.getBoundingClientRect(), values.length),
    );

  return (
    <>
      <svg
        viewBox={`0 0 ${values.length} ${height}`}
        width={values.length}
        height={height}
        role="img"
        aria-label={label}
        preserveAspectRatio="none"
        onMouseLeave={tip ? clear : undefined}
        onMouseMove={tip ? track : undefined}
        className={cn("block h-full w-full", TONE_TEXT[surface][tone], className)}
      >
        {values.map((value, index) =>
          value === null || !Number.isFinite(value) ? null : (
            <rect
              // The index *is* the identity here: a bar is its interval, and the series is a fixed
              // grid the server laid out rather than a list that reorders.
              // biome-ignore lint/suspicious/noArrayIndexKey: the index is the interval's identity
              key={index}
              x={index + BAR_GAP / 2}
              width={1 - BAR_GAP}
              y={height - Math.max(ZERO_STUB, (value / top) * usable + ZERO_STUB)}
              height={Math.max(ZERO_STUB, (value / top) * usable + ZERO_STUB)}
              fill="currentColor"
              fillOpacity={value > 0 ? 1 : 0.3}
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
