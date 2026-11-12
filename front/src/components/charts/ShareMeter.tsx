import { CHART_SURFACE } from "@lib/charts/chartSurface";
import { METRIC, METRIC_INK } from "@lib/charts/metricTokens";
import { cn } from "@lib/utils";

import type { ChartSurface, Metric } from "@lib/charts/interfaces/chartTypes";

/** How many segments a meter has, and how wide each one is. */
const SEGMENTS = 20;
const SEGMENT_PX = 4;
const GAP_PX = 1;
const HEIGHT_PX = 6;
const WIDTH_PX = SEGMENTS * (SEGMENT_PX + GAP_PX) - GAP_PX;

/**
 * A share of a total, as twenty segments (IKN-86): the SHARE column of a table, a browser's slice
 * of the visitors, how full a disk is.
 *
 * Segments rather than a smooth fill because a share column is read by comparing rows, and
 * counting five-percent steps down a table is quicker than judging the ends of twenty lengths.
 * Anything above zero lights at least one segment, so "almost none" and "none" read differently.
 *
 * `aria-hidden`, as the bar it replaces was: the figure is always printed beside it, and a screen
 * reader would otherwise read one fact twice in two units.
 */
export const ShareMeter = ({
  share,
  metric = METRIC.visitors,
  surface = CHART_SURFACE.work,
  className,
}: ShareMeterProps) => {
  const clamped = Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 0;
  const lit = clamped > 0 ? Math.max(1, Math.round(clamped * SEGMENTS)) : 0;

  return (
    <svg
      aria-hidden="true"
      width={WIDTH_PX}
      height={HEIGHT_PX}
      className={cn("block flex-none", className)}
    >
      {Array.from({ length: SEGMENTS }, (_, index) => (
        <rect
          // biome-ignore lint/suspicious/noArrayIndexKey: a segment is its position
          key={index}
          x={index * (SEGMENT_PX + GAP_PX)}
          width={SEGMENT_PX}
          height={HEIGHT_PX}
          fill="currentColor"
          className={cn(
            "transition-colors duration-150 ease-out",
            index < lit ? METRIC_INK[metric].bar : EMPTY[surface],
          )}
        />
      ))}
    </svg>
  );
};

/** Empty segments are a step off the ground the meter stands on. */
const EMPTY: Record<ChartSurface, string> = {
  [CHART_SURFACE.work]: "text-chart-grid",
  [CHART_SURFACE.chassis]: "text-chassis-border-strong",
};

type ShareMeterProps = {
  /** 0–1. */
  share: number;
  /** Whose colour the lit segments are: the table's metric. */
  metric?: Metric;
  surface?: ChartSurface;
  className?: string;
};
