"use client";

import { BASELINE, layoutOf, pointIndexAt, pointsOf, runsOf } from "@components/ui/series";
import { TONE_TEXT } from "@components/ui/surface";
import { Tooltip, TooltipBlock } from "@components/ui/Tooltip";
import { useCursorHover } from "@components/ui/useCursorHover";
import { tickIndices } from "@lib/chartTicks";
import { formatLatency, PERCENTILE } from "@lib/metricsFormat";
import { formatMs } from "@lib/serviceFormat";
import { cn } from "@lib/utils";
import { intervalLabel, timeLabel } from "@lib/zone";
import { useZone } from "@lib/zoneState";
import { METRICS_TEXT } from "@text/metrics";

import type { Tone } from "@components/ui/surface";
import type { Percentile, RouteDetail } from "@lib/metricsTypes";
import type { MouseEvent } from "react";

/**
 * p50, p95 and p99 over the range, on **one** scale (IKN-23 §2).
 *
 * One scale is the whole point of drawing them together: the gap between the p50 and the p99 is
 * the tail, and a chart that scaled each line to its own box would draw three identical curves.
 * The floor is zero for the same reason — a latency's magnitude is what is being compared.
 *
 * Holes stay holes: an interval the server could not quote is `null` and each line is cut there,
 * exactly as `Sparkline` cuts its own (`series.ts`).
 */

/** The `viewBox`, in user units; stretched to the card with `preserveAspectRatio="none"`. */
const W = 300;
const H = 100;
const X_TICKS = 5;

/** Drawn back to front, so the p50 — the line most of the requests are on — is on top. */
const LINES: { key: Percentile; tone: Tone }[] = [
  { key: PERCENTILE.p99, tone: "error" },
  { key: PERCENTILE.p95, tone: "warn" },
  { key: PERCENTILE.p50, tone: "ok" },
];

export const PercentileChart = ({ detail }: PercentileChartProps) => {
  const { tz } = useZone();
  const { hover, show, clear } = useCursorHover<number>();

  const values: Record<Percentile, (number | null)[]> = {
    p50: detail.p50.points.map((point) => point.v),
    p95: detail.p95.points.map((point) => point.v),
    p99: detail.p99.points.map((point) => point.v),
  };
  const count = detail.p95.points.length;

  // The y of every line from one layout over all three, so the scale is shared; the x is the
  // series' own, because the merged list is three times longer than any line.
  const scale = layoutOf([...values.p50, ...values.p95, ...values.p99], W, H, BASELINE.zero);
  const step = count > 1 ? W / (count - 1) : 0;
  const layout = { ...scale, x: (index: number) => index * step };

  const known = scale.max > 0 && [values.p50, values.p95, values.p99].some((line) => line.some((v) => v !== null));
  const threshold = detail.p95ThresholdMs <= scale.max ? scale.y(detail.p95ThresholdMs) : null;

  const track = (event: MouseEvent<SVGSVGElement>) =>
    show(event.clientX, event.clientY, pointIndexAt(event.clientX, event.currentTarget.getBoundingClientRect(), count));

  const tip = (index: number) => {
    const point = detail.p95.points[index];
    if (point === undefined) return null;

    return (
      <TooltipBlock
        subject={intervalLabel(Date.parse(point.t), detail.bucketMs, tz)}
        rows={LINES.map(({ key }) => {
          const value = values[key][index];
          return { label: key, value: formatLatency(value) };
        })}
      />
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <div className="relative min-h-0 flex-1">
        {known ? (
          <>
            {/* The top of the scale, in words — the chart has no axis otherwise. */}
            <span className="pointer-events-none absolute top-0 left-0 text-micro tabular-nums text-work-text-dim">
              {formatMs(scale.max)}ms
            </span>
            <svg
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={METRICS_TEXT.chartLabel(`${detail.summary.method} ${detail.summary.route}`)}
              onMouseMove={track}
              onMouseLeave={clear}
              className="h-full w-full overflow-visible"
              data-testid="percentile-chart"
            >
              {[0.25, 0.5, 0.75].map((fraction) => (
                <line
                  key={fraction}
                  x1={0}
                  x2={W}
                  y1={H * fraction}
                  y2={H * fraction}
                  className="stroke-work-border-strong"
                  strokeWidth={1}
                  strokeDasharray="3 4"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {threshold !== null && (
                <line
                  x1={0}
                  x2={W}
                  y1={threshold}
                  y2={threshold}
                  stroke="currentColor"
                  strokeOpacity={0.6}
                  strokeWidth={1}
                  strokeDasharray="1 3"
                  vectorEffect="non-scaling-stroke"
                  className={TONE_TEXT.work.error}
                >
                  <title>{METRICS_TEXT.threshold}</title>
                </line>
              )}
              {LINES.map(({ key, tone }) => (
                <g
                  key={key}
                  className={cn("transition-colors duration-150 ease-out", TONE_TEXT.work[tone])}
                >
                  {runsOf(values[key]).map((run) =>
                    run.values.length > 1 ? (
                      <polyline
                        key={run.start}
                        points={pointsOf(run, layout)}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={key === PERCENTILE.p95 ? 1.4 : 1}
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                      />
                    ) : (
                      <circle
                        key={run.start}
                        cx={layout.x(run.start)}
                        cy={layout.y(run.values[0])}
                        r={1}
                        fill="currentColor"
                      />
                    ),
                  )}
                </g>
              ))}
            </svg>
            <Tooltip
              mode="cursor"
              point={hover}
            >
              {hover ? tip(hover.data) : null}
            </Tooltip>
          </>
        ) : (
          <p className="flex h-full items-center justify-center text-row text-work-text-dim">{METRICS_TEXT.noChart}</p>
        )}
      </div>
      {/* Always rendered, so the card does not change height between a chart and its absence. */}
      <div className="flex h-3.5 flex-none justify-between text-micro tabular-nums text-work-text-dim">
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

/** The legend, in the card header — the mockup's three swatches. */
export const PercentileLegend = () => (
  <span className="flex items-center gap-2.5 text-micro text-work-text-muted">
    {[...LINES].reverse().map(({ key, tone }) => (
      <span
        key={key}
        className="flex items-center gap-1"
      >
        <span className={cn("h-0.5 w-2.5", TONE_TEXT.work[tone], "bg-current")} />
        {key}
      </span>
    ))}
  </span>
);
