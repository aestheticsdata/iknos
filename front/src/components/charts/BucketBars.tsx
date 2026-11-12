"use client";

import { meanOf, peakOf } from "@lib/charts/barGeometry";
import { peakAvgLabel } from "@lib/charts/chartFormat";
import { CHART_SURFACE } from "@lib/charts/chartSurface";
import { cn } from "@lib/utils";
import { useId } from "react";
import { AXIS, BucketMarks } from "./BucketMarks";
import { ChartFrame } from "./ChartFrame";

import type { ChartSurface } from "@lib/charts/interfaces/chartTypes";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import type { BucketSeries } from "./interfaces/bucketBarsTypes";

/**
 * A count per bucket, as bars: the one chart for anything counted (IKN-86). That covers visitors,
 * page views, requests, bots, errors, log lines, ingested events and occurrences.
 *
 * One row on its own: a tile's mini-chart, a rail sparkline, an issue's occurrences. A panel of
 * several rows sharing a crosshair is `BucketPanel`.
 */
export const BucketBars = ({
  series,
  height,
  label,
  tip,
  showPeak = false,
  surface = CHART_SURFACE.work,
  className,
  ...rest
}: BucketBarsProps) => {
  const hatchId = useId().replace(/:/g, "");
  const last = series.futureFrom != null ? series.futureFrom - 1 : series.values.length - 1;
  const peak = peakAvgLabel(peakOf(series.values), meanOf(series.values, last));

  return (
    <div className={cn("flex min-w-0 flex-col", className)}>
      {/* 12px reserved above the plot, so the label can never sit on the tallest bar. */}
      {showPeak && (
        <span
          className={cn(
            "flex h-3 flex-none justify-end text-chart-label leading-none tabular-nums",
            surface === CHART_SURFACE.chassis ? "text-chassis-text-muted" : "text-chart-ref",
          )}
        >
          {peak}
        </span>
      )}
      <ChartFrame
        count={series.values.length}
        height={height + 1}
        label={label}
        tip={tip}
        {...rest}
      >
        {({ width }) => (
          <BucketMarks
            series={series}
            width={width}
            height={height}
            hatchId={hatchId}
            axis={surface === CHART_SURFACE.chassis ? AXIS.chassis : AXIS.work}
          />
        )}
      </ChartFrame>
    </div>
  );
};

type BucketBarsProps = {
  series: BucketSeries;
  /** The plot's height in pixels; the baseline adds one below it. */
  height: number;
  label: string;
  /** What the bucket under the crosshair says. Given, the chart is interactive. */
  tip?: (index: number) => ReactNode;
  /** `peak 6.5 · avg 1.6` above the plot, top right. */
  showPeak?: boolean;
  surface?: ChartSurface;
  className?: string;
} & Omit<ComponentPropsWithoutRef<"div">, "children">;
