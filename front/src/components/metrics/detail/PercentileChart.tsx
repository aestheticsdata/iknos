"use client";

import { ChartTip } from "@components/charts/ChartTip";
import { useElementSize } from "@components/charts/hooks/useElementSize";
import { RangeLegend, RangeStrips } from "@components/charts/RangeStrips";
import { seriesSummary } from "@lib/charts/chartFormat";
import { METRIC, METRIC_INK } from "@lib/charts/metricTokens";
import { tickIndices } from "@lib/chartTicks";
import { formatLatency, PERCENTILE } from "@lib/metricsFormat";
import { intervalLabel, timeLabel } from "@lib/zone";
import { useZone } from "@lib/zoneState";
import { METRICS_TEXT } from "@text/metrics";

import type { PercentileBucket } from "@lib/charts/interfaces/chartTypes";
import type { RouteDetail } from "@lib/metricsTypes";

const X_TICKS = 5;

/**
 * What the box holds besides the strips' plot: the baseline (1), the gap (4) and the tick row (14).
 * Exact on purpose: the plot is sized from the box, and a box whose height came from its content
 * would otherwise grow by the difference on every measurement.
 */
const CHROME_PX = 19;

/**
 * p50, p95 and p99 over the range as range strips, on **one** scale (IKN-23 §2, IKN-86).
 *
 * Each bucket is one strip from its p50 to its p99, with its p95 as a tick across it. The length
 * of the strip is the tail: how far the slow requests sit from the typical one. The SLO is the
 * dashed red line. The floor is zero, because a latency's size is what is being compared.
 *
 * An interval the server could not quote is `null` and draws no strip.
 */
export const PercentileChart = ({ detail }: PercentileChartProps) => {
  const { tz } = useZone();
  const { ref, height: box } = useElementSize<HTMLDivElement>();
  // The strips take whatever the card leaves them, less the tick row and the baseline.
  const height = Math.max(60, box - CHROME_PX);

  const buckets: PercentileBucket[] = detail.p95.points.map((point, index) => ({
    p50: detail.p50.points[index]?.v ?? null,
    p95: point.v,
    p99: detail.p99.points[index]?.v ?? null,
  }));
  const count = buckets.length;
  const known = buckets.some((bucket) => bucket.p95 !== null || bucket.p99 !== null);
  const last = detail.p95.points.at(-1);
  const partialIndex = last && Date.parse(last.t) + detail.bucketMs > Date.parse(detail.to) ? count - 1 : null;
  const name = (index: number) => {
    const point = detail.p95.points[index];
    return point ? intervalLabel(Date.parse(point.t), detail.bucketMs, tz) : null;
  };

  return (
    <div
      ref={ref}
      className="flex min-h-0 flex-1 flex-col gap-1"
    >
      {known ? (
        <RangeStrips
          buckets={buckets}
          height={height}
          sloMs={detail.p95ThresholdMs}
          partialIndex={partialIndex}
          label={seriesSummary({
            series: METRICS_TEXT.chartLabel(`${detail.summary.method} ${detail.summary.route}`),
            span: "p95",
            total: null,
            values: buckets.map((bucket) => bucket.p95),
            bucketName: name,
          })}
          tip={(index) => (
            <ChartTip
              title={name(index) ?? ""}
              rows={[
                {
                  label: PERCENTILE.p50,
                  value: formatLatency(buckets[index]?.p50 ?? null),
                  swatch: METRIC_INK[METRIC.range].swatch,
                },
                {
                  label: PERCENTILE.p95,
                  value: formatLatency(buckets[index]?.p95 ?? null),
                  swatch: METRIC_INK[METRIC.p95].swatch,
                },
                {
                  label: PERCENTILE.p99,
                  value: formatLatency(buckets[index]?.p99 ?? null),
                  swatch: METRIC_INK[METRIC.range].swatch,
                },
              ]}
            />
          )}
        />
      ) : (
        <p className="flex flex-1 items-center justify-center text-row text-work-text-dim">{METRICS_TEXT.noChart}</p>
      )}
      {/* Always rendered, so the card does not change height between a chart and its absence. */}
      <div className="flex h-3.5 flex-none justify-between text-chart-label tabular-nums text-chart-ref">
        {tickIndices(count, X_TICKS).map((index) => (
          <span key={index}>{timeLabel(Date.parse(detail.p95.points[index].t), detail.bucketMs, tz)}</span>
        ))}
      </div>
    </div>
  );
};

type PercentileChartProps = {
  detail: RouteDetail;
};

/** The legend, in the card header: the strip, the p95 tick, and the SLO. */
export const PercentileLegend = ({ sloMs }: PercentileLegendProps) => (
  <RangeLegend slo={sloMs === null ? null : METRICS_TEXT.slo(formatLatency(sloMs))} />
);

type PercentileLegendProps = {
  sloMs: number | null;
};
