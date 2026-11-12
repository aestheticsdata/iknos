"use client";

import { SURFACE_SCROLL } from "@components/ui/surface";
import { axisTicks, formatMicros } from "@lib/spanTimeline";
import { cn } from "@lib/utils";
import { TRACES_TEXT } from "@text/traces";
import { WaterfallRow } from "./WaterfallRow";

import type { Timeline, WaterfallLine } from "@lib/interfaces/traceSpanTypes";

/** Four intervals: 0, a quarter, half, three quarters and the end of the run. */
const AXIS_STEPS = 4;

/**
 * The span tree as a waterfall (IKN-87) — **a new component, not `TraceTimeline`'s**.
 *
 * `TraceTimeline` draws log lines that merely share an id, flat on purpose, because nothing in
 * them says which caused which. OTLP spans do say: each names its parent. So this one nests, by
 * indentation in the name column, and places every bar on the run's own clock — left edge at the
 * span's start, width its duration, both in percent of the whole run.
 *
 * The axis above the bars is sticky inside the scroller, like a table's heading band, so a run of
 * two hundred spans keeps its scale in view.
 */
export const SpanWaterfall = ({ lines, timeline, selected, onPick, onHover }: SpanWaterfallProps) => (
  <div
    role="tree"
    aria-label={TRACES_TEXT.waterfallLabel}
    className={cn("min-h-0 flex-1 overflow-y-auto", SURFACE_SCROLL.work)}
    onMouseLeave={() => onHover(null)}
    data-testid="span-waterfall"
  >
    <div className="sticky top-0 z-10 flex h-head-band border-b border-work-border bg-work-inset">
      <div className="w-span-names flex-none" />
      <div className="relative mx-3 flex-1">
        {axisTicks(timeline, AXIS_STEPS).map((tick) => (
          <span
            key={tick.pct}
            className={cn(
              "absolute top-0 flex h-full items-center text-kicker tabular-nums text-work-text-dim",
              tick.pct === 100 ? "-translate-x-full" : tick.pct > 0 && "-translate-x-1/2",
            )}
            style={{ left: `${tick.pct}%` }}
          >
            {formatMicros(tick.offsetUs)}
          </span>
        ))}
      </div>
      {/* Above the duration column, which has no scale of its own. */}
      <div className="w-16 flex-none" />
    </div>

    {lines.map((line) => (
      <WaterfallRow
        key={line.span.spanId}
        line={line}
        timeline={timeline}
        selected={line.span.spanId === selected}
        onPick={onPick}
        onHover={onHover}
      />
    ))}
  </div>
);

type SpanWaterfallProps = {
  lines: WaterfallLine[];
  timeline: Timeline;
  selected: string | null;
  onPick: (spanId: string) => void;
  onHover: (spanId: string | null) => void;
};
