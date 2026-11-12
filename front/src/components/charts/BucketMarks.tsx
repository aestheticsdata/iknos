import { barHeight, barSpan, MIN_PARTIAL_PX, peakOf, slotCenter } from "@lib/charts/barGeometry";
import { curvePath } from "@lib/charts/curvePath";
import { METRIC, METRIC_INK } from "@lib/charts/metricTokens";
import { cn } from "@lib/utils";
import { Hatch, HatchedRect } from "./Hatch";

import type { ReactElement } from "react";
import type { BucketSeries } from "./interfaces/bucketBarsTypes";

/**
 * The marks of one row of bars, inside a `ChartFrame`'s `<svg>` (IKN-86).
 *
 * Solid bars of one flat colour, square corners, a 1px gap. Nothing between a bar and the
 * baseline but the bar itself: no gradient, no rounding, no growing in. A bucket with nothing in
 * it has no bar. A bucket with anything in it has at least 1.5px. The bucket still in progress is
 * hatched, and a bucket still to come is a tick on the baseline.
 *
 * The scale runs from 0 to the row's own maximum, one scale per row: these are small multiples,
 * and putting bots on the visitors' scale would flatten one or the other.
 */
export const BucketMarks = ({ series, width, height, hatchId, axis = AXIS.work }: BucketMarksProps) => {
  const { values, metric, partialIndex = null, futureFrom = null, minTop = 0, threshold = null } = series;
  const count = values.length;
  const ink = METRIC_INK[metric];
  const trend = series.trend ?? null;
  const top = Math.max(minTop, peakOf(values), threshold?.value ?? 0);

  /* With a threshold the colour says which side of it a bar is on. With a trend drawn over them,
     the bars step back to their tint so the curve reads first. */
  const inkOf = (value: number | null): string => {
    if (threshold !== null) {
      return value !== null && value > threshold.value ? METRIC_INK[METRIC.errors].bar : METRIC_INK[METRIC.neutral].bar;
    }
    return trend !== null ? ink.tint : ink.bar;
  };

  const groups = new Map<string, ReactElement[]>();
  for (let index = 0; index < count; index++) {
    const value = values[index];
    const span = barSpan(index, count, width);
    const bar = inkOf(value);

    if (futureFrom !== null && index >= futureFrom) continue;

    if (index === partialIndex) {
      const h = Math.max(MIN_PARTIAL_PX, barHeight(value, top, height));
      push(
        groups,
        bar,
        <HatchedRect
          key={index}
          x={span.x}
          y={height - h}
          width={span.width}
          height={h}
          patternId={`${hatchId}-${inkKey(bar)}`}
        />,
      );
      continue;
    }

    const h = barHeight(value, top, height);
    if (h === 0) continue;
    push(
      groups,
      bar,
      <rect
        key={index}
        x={span.x}
        y={height - h}
        width={span.width}
        height={h}
      />,
    );
  }

  const trendPoints =
    trend === null
      ? []
      : trend.flatMap((value, index) =>
          value === null ? [] : [{ x: slotCenter(index, count, width), y: height - (value / (top || 1)) * height }],
        );

  return (
    <g>
      {series.days?.map((day) => {
        const x = barSpan(day.index, count, width).x - 0.5;
        return (
          <line
            key={day.index}
            x1={x}
            x2={x}
            y1={0}
            y2={height}
            className="stroke-chart-grid"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        );
      })}

      {[...groups.entries()].map(([bar, marks]) => (
        <g
          key={bar}
          className={cn(bar, "transition-colors duration-150 ease-out")}
          fill="currentColor"
        >
          {partialIndex !== null && (
            <Hatch
              id={`${hatchId}-${inkKey(bar)}`}
              ink={bar}
            />
          )}
          {marks}
        </g>
      ))}

      {futureFrom !== null && (
        <g className={axis}>
          {values.slice(futureFrom).map((_, offset) => {
            const span = barSpan(futureFrom + offset, count, width);
            return (
              <rect
                // biome-ignore lint/suspicious/noArrayIndexKey: a bucket's index is its identity
                key={offset}
                x={span.x}
                y={height - 1}
                width={span.width}
                height={1}
                fill="currentColor"
              />
            );
          })}
        </g>
      )}

      <rect
        x={0}
        y={height}
        width={width}
        height={1}
        className={axis}
        fill="currentColor"
      />

      {threshold !== null && top > 0 && (
        <line
          x1={0}
          x2={width}
          y1={Math.round(height - (threshold.value / top) * height) + 0.5}
          y2={Math.round(height - (threshold.value / top) * height) + 0.5}
          className="stroke-chart-error"
          strokeWidth={1}
          strokeDasharray="3 2"
        />
      )}

      {trendPoints.length > 1 && (
        <path
          d={curvePath(trendPoints)}
          fill="none"
          className={cn(ink.strong, "stroke-current")}
          strokeWidth={1.6}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
    </g>
  );
};

/** The baseline's ink, on the light panel or on the dark rail. */
export const AXIS = {
  work: "text-chart-axis",
  chassis: "text-chart-spark-axis",
} as const;

type Axis = (typeof AXIS)[keyof typeof AXIS];

type BucketMarksProps = {
  series: BucketSeries;
  width: number;
  /** The plot's height. The baseline is drawn one pixel below it. */
  height: number;
  /** A prefix for this chart's hatch patterns, unique in the document. */
  hatchId: string;
  axis?: Axis;
};

/** A pattern id fragment from an ink class: `text-chart-error` → `chart-error`. */
const inkKey = (ink: string): string => ink.replace(/^text-/, "");

const push = (groups: Map<string, ReactElement[]>, key: string, mark: ReactElement) => {
  const list = groups.get(key);
  if (list) list.push(mark);
  else groups.set(key, [mark]);
};
