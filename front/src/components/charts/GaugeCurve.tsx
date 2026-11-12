"use client";

import { meanOf, slotCenter } from "@lib/charts/barGeometry";
import { formatChartValue } from "@lib/charts/chartFormat";
import { CHART_SURFACE } from "@lib/charts/chartSurface";
import { areaPath, curvePath } from "@lib/charts/curvePath";
import { drawDomain, extentOf, runsOf, yOn } from "@lib/charts/gaugeScale";
import { METRIC, METRIC_INK } from "@lib/charts/metricTokens";
import { relativeTicks } from "@lib/charts/timeAxis";
import { cn } from "@lib/utils";
import { useId } from "react";
import { ChartFrame } from "./ChartFrame";

import type { ChartSurface, Domain, GaugeMark, Metric } from "@lib/charts/interfaces/chartTypes";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

/**
 * A continuous gauge over time, as a curve (IKN-86): req/s, CPU, memory, load, a p95.
 *
 * **Always on a frame.** A curve on its own floats with nothing to say what its height is worth,
 * so this one has a left and a bottom axis, the series' max and min printed beside the first, three
 * dotted guides at a quarter, a half and three quarters with the time under the second, the range's
 * average as a dashed line labelled `avg 38.4`, and a dot where the series is now.
 *
 * The curve is monotone, so it never dips below a value it passes through, and the area under it
 * fades from 30% to nothing. That is the only gradient the chart language allows. Holes stay
 * holes: a run of unknown buckets cuts the curve, and nothing is drawn across time nobody measured.
 */
export const GaugeCurve = ({
  values,
  metric = METRIC.gauge,
  height,
  spanMs,
  label,
  tip,
  domain: fixed,
  marks = [],
  surface = CHART_SURFACE.work,
  className,
  ...rest
}: GaugeCurveProps) => {
  const gradientId = useId().replace(/:/g, "");
  const extent = extentOf(values);
  if (extent === null) return null;

  const domain = fixed ?? drawDomain(extent);
  const avg = meanOf(values);
  const ink = METRIC_INK[metric];
  const skin = SKIN[surface];
  const [start, middle, now] = relativeTicks(spanMs);
  const avgTop = avg === null ? null : (yOn(avg, domain, height) / height) * 100;

  return (
    <div
      className={cn("flex min-w-0 flex-col gap-1", className)}
      {...rest}
    >
      <div
        className="flex gap-1.25"
        style={{ height }}
      >
        <div
          className={cn(
            "flex w-5 flex-none flex-col justify-between text-right text-chart-tick leading-none tabular-nums",
            skin.label,
          )}
        >
          <span>{formatChartValue(fixed ? fixed.max : extent.max)}</span>
          <span>{formatChartValue(fixed ? fixed.min : extent.min)}</span>
        </div>
        <div className={cn("relative min-w-0 flex-1 border-b border-l", skin.axis)}>
          <ChartFrame
            count={values.length}
            height={height - 1}
            label={label}
            tip={tip}
          >
            {({ width }) => {
              const plot = height - 1;
              const runs = runsOf(values, (value, index) => ({
                x: slotCenter(index, values.length, width),
                y: yOn(value, domain, plot),
              }));
              const lastIndex = lastKnown(values);
              const lastValue = lastIndex === null ? null : values[lastIndex];

              return (
                <g>
                  <defs className={ink.bar}>
                    <linearGradient
                      id={gradientId}
                      x1={0}
                      y1={0}
                      x2={0}
                      y2={1}
                    >
                      <stop
                        offset={0}
                        stopColor="currentColor"
                        stopOpacity={0.3}
                      />
                      <stop
                        offset={1}
                        stopColor="currentColor"
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  {[0.25, 0.5, 0.75].map((fraction) => (
                    <line
                      key={fraction}
                      x1={Math.round(width * fraction) + 0.5}
                      x2={Math.round(width * fraction) + 0.5}
                      y1={0}
                      y2={plot}
                      className={skin.grid}
                      strokeWidth={1}
                      strokeDasharray="2 3"
                    />
                  ))}
                  {marks.map((mark) =>
                    mark.value >= domain.min && mark.value <= domain.max ? (
                      <line
                        key={mark.value}
                        x1={0}
                        x2={width}
                        y1={Math.round(yOn(mark.value, domain, plot)) + 0.5}
                        y2={Math.round(yOn(mark.value, domain, plot)) + 0.5}
                        className="stroke-chart-error"
                        strokeWidth={1}
                        strokeDasharray="4 3"
                      >
                        <title>{mark.label}</title>
                      </line>
                    ) : null,
                  )}
                  {avg !== null && (
                    <line
                      x1={0}
                      x2={width}
                      y1={Math.round(yOn(avg, domain, plot)) + 0.5}
                      y2={Math.round(yOn(avg, domain, plot)) + 0.5}
                      className={skin.ref}
                      strokeWidth={1}
                      strokeDasharray="3 3"
                    />
                  )}
                  <g className={ink.bar}>
                    {runs.map((run) =>
                      run.length > 1 ? (
                        <g key={run[0].x}>
                          <path
                            d={areaPath(run, plot)}
                            fill={`url(#${gradientId})`}
                          />
                          <path
                            d={curvePath(run)}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1.6}
                            strokeLinejoin="round"
                            strokeLinecap="round"
                          />
                        </g>
                      ) : (
                        <circle
                          key={run[0].x}
                          cx={run[0].x}
                          cy={run[0].y}
                          r={1}
                          fill="currentColor"
                        />
                      ),
                    )}
                    {lastIndex !== null && lastValue !== null && (
                      <circle
                        cx={slotCenter(lastIndex, values.length, width)}
                        cy={yOn(lastValue, domain, plot)}
                        r={3}
                        fill="currentColor"
                        className={skin.halo}
                        strokeWidth={2}
                      />
                    )}
                  </g>
                </g>
              );
            }}
          </ChartFrame>
          {avg !== null && avgTop !== null && (
            /* Above the line and against the panel's own ground, so the dash never runs through it. */
            <span
              className={cn(
                "pointer-events-none absolute left-1 -translate-y-full px-0.5 text-chart-tick leading-none",
                skin.avgLabel,
              )}
              style={{ top: `calc(${avgTop}% - 1px)` }}
            >
              avg {formatChartValue(avg)}
            </span>
          )}
        </div>
      </div>
      <div className={cn("flex justify-between pl-6.25 text-chart-tick leading-none", skin.label)}>
        <span>{start}</span>
        <span>{middle}</span>
        <span>{now}</span>
      </div>
    </div>
  );
};

/** The classes a gauge's furniture takes on each ground. */
type GaugeSkin = { label: string; axis: string; grid: string; ref: string; halo: string; avgLabel: string };

const SKIN: Record<ChartSurface, GaugeSkin> = {
  [CHART_SURFACE.work]: {
    label: "text-chart-label-muted",
    axis: "border-chart-axis",
    grid: "stroke-chart-grid",
    ref: "stroke-chart-ref",
    halo: "stroke-chart-ground",
    avgLabel: "bg-chart-ground text-chart-ref",
  },
  [CHART_SURFACE.chassis]: {
    label: "text-chassis-text-dim",
    axis: "border-chassis-border-strong",
    grid: "stroke-chassis-border",
    ref: "stroke-chassis-text-dim",
    halo: "stroke-chassis-surface",
    avgLabel: "bg-chassis-surface text-chassis-text-muted",
  },
};

const lastKnown = (values: readonly (number | null)[]): number | null => {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null && Number.isFinite(values[i])) return i;
  return null;
};

type GaugeCurveProps = {
  values: readonly (number | null)[];
  metric?: Metric;
  /** The frame's height in pixels, bottom axis included. */
  height: number;
  /** What the series spans, for the `−60m · −30m · now` ticks. */
  spanMs: number;
  label: string;
  tip?: (index: number) => ReactNode;
  /** A fixed axis, such as 0–100 for a percentage of something whole. Otherwise min → max of the series. */
  domain?: Domain;
  /** Dashed red lines at values on the gauge's own axis: the disk chart's alert rules. */
  marks?: readonly GaugeMark[];
  surface?: ChartSurface;
  className?: string;
} & Omit<ComponentPropsWithoutRef<"div">, "children">;
