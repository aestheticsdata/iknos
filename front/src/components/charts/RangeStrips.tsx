"use client";

import { slotCenter } from "@lib/charts/barGeometry";
import { useId } from "react";
import { ChartFrame } from "./ChartFrame";
import { Hatch, HatchedRect } from "./Hatch";

import type { PercentileBucket } from "@lib/charts/interfaces/chartTypes";
import type { ReactNode } from "react";

/**
 * Latency per bucket as a range strip (IKN-86): a solid strip from p50 to p99, 40% of the slot, and
 * a 2px p95 tick across 80% of it.
 *
 * Three lines on one chart crossed each other and hid the one fact a latency chart exists to show.
 * That fact is the spread: how far the slow requests sit from the typical one. A strip is that
 * spread drawn as a length. The SLO is a dashed red line across the whole plot. The bucket in
 * progress is hatched.
 *
 * The scale is 0 → the highest p99 or the SLO, whichever is higher, so the SLO line is always on
 * the chart it is a promise about.
 */
export const RangeStrips = ({ buckets, height, sloMs, partialIndex = null, label, tip }: RangeStripsProps) => {
  const hatchId = useId().replace(/:/g, "");
  const top = Math.max(sloMs ?? 0, ...buckets.map((b) => b.p99 ?? b.p95 ?? 0)) * 1.05 || 1;
  const y = (ms: number) => height - (ms / top) * height;

  return (
    <ChartFrame
      count={buckets.length}
      height={height + 1}
      label={label}
      tip={tip}
      data-testid="percentile-chart"
    >
      {({ width }) => {
        const slot = width / Math.max(1, buckets.length);
        return (
          <g>
            <g
              className="text-chart-range"
              fill="currentColor"
            >
              {partialIndex !== null && (
                <Hatch
                  id={hatchId}
                  ink="text-chart-neutral"
                />
              )}
              {buckets.map((bucket, index) => {
                const low = bucket.p50 ?? bucket.p95;
                const high = bucket.p99 ?? bucket.p95;
                if (low === null || high === null) return null;
                const center = slotCenter(index, buckets.length, width);
                const w = Math.max(2, Math.round(slot * 0.4));
                const x = Math.round(center - w / 2);
                const upper = Math.round(y(high));
                const h = Math.max(2, Math.round(y(low)) - upper);
                return index === partialIndex ? (
                  <g
                    // biome-ignore lint/suspicious/noArrayIndexKey: a bucket's index is its identity
                    key={index}
                    className="text-chart-neutral"
                  >
                    <HatchedRect
                      x={x}
                      y={upper}
                      width={w}
                      height={h}
                      patternId={hatchId}
                    />
                  </g>
                ) : (
                  <rect
                    // biome-ignore lint/suspicious/noArrayIndexKey: a bucket's index is its identity
                    key={index}
                    x={x}
                    y={upper}
                    width={w}
                    height={h}
                  />
                );
              })}
            </g>
            {sloMs !== null && (
              <line
                x1={0}
                x2={width}
                y1={Math.round(y(sloMs)) + 0.5}
                y2={Math.round(y(sloMs)) + 0.5}
                className="stroke-chart-error"
                strokeWidth={1}
                strokeDasharray="4 3"
              />
            )}
            <g
              className="text-chart-p95"
              fill="currentColor"
            >
              {buckets.map((bucket, index) => {
                if (bucket.p95 === null) return null;
                const center = slotCenter(index, buckets.length, width);
                const w = Math.max(3, Math.round(slot * 0.8));
                return (
                  <rect
                    // biome-ignore lint/suspicious/noArrayIndexKey: a bucket's index is its identity
                    key={index}
                    x={Math.round(center - w / 2)}
                    y={Math.round(y(bucket.p95)) - 1}
                    width={w}
                    height={2}
                  />
                );
              })}
            </g>
            <rect
              x={0}
              y={height}
              width={width}
              height={1}
              className="text-chart-axis"
              fill="currentColor"
            />
          </g>
        );
      }}
    </ChartFrame>
  );
};

/** The legend for a panel header: `p50 → p99 range`, `p95`, `SLO 300ms`. */
export const RangeLegend = ({ slo }: RangeLegendProps) => (
  <span className="flex items-center gap-3.5 text-micro text-chart-ref">
    <span className="flex items-center gap-1.25">
      <span className="h-3 w-1.5 bg-chart-range" />
      p50 → p99 range
    </span>
    <span className="flex items-center gap-1.25">
      <span className="h-0.5 w-2.5 bg-chart-p95" />
      p95
    </span>
    {slo !== null && (
      <span className="flex items-center gap-1.25">
        <span className="w-3 border-t border-dashed border-chart-error" />
        {slo}
      </span>
    )}
  </span>
);

type RangeLegendProps = {
  /** `SLO 300ms`, or `null` when the route has none. */
  slo: string | null;
};

type RangeStripsProps = {
  buckets: readonly PercentileBucket[];
  /** The plot's height; the baseline is one pixel below it. */
  height: number;
  /** The latency promise, drawn as a dashed red line. */
  sloMs: number | null;
  partialIndex?: number | null;
  label: string;
  tip?: (index: number) => ReactNode;
};
