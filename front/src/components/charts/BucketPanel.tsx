"use client";

import { Card } from "@components/ui/Card";
import { TOOLTIP_SKIN, Tooltip } from "@components/ui/Tooltip";
import { meanOf, peakOf } from "@lib/charts/barGeometry";
import { formatChartValue, peakAvgLabel } from "@lib/charts/chartFormat";
import { METRIC_INK } from "@lib/charts/metricTokens";
import { cn } from "@lib/utils";
import { useId } from "react";
import { BucketMarks } from "./BucketMarks";
import { ChartFrame } from "./ChartFrame";
import { ChartTip } from "./ChartTip";
import { useCrosshair } from "./hooks/useCrosshair";
import { PartialLegend, TrendToggle } from "./TrendToggle";

import type { DayStart } from "@lib/charts/interfaces/chartTypes";
import type { PanelRow, TrendSwitch } from "./interfaces/bucketPanelTypes";

/** The plot's height per row, the handoff's 56px. */
const ROW_PLOT_PX = 56;

/**
 * Several counts over the same buckets, one row each, sharing one crosshair (IKN-86). This is the
 * traffic page's "over time" panel.
 *
 * Small multiples rather than one chart with three series: each row has its own scale, because a
 * crawl of 400 bot requests on the visitors' scale would flatten a day of twelve visitors to
 * nothing. What ties the rows together is the x axis. Pointing at any row puts the crosshair on
 * all of them, and the tooltip names every series at that bucket.
 *
 * The plot column takes focus, and ←/→ walk the crosshair along it.
 */
export const BucketPanel = ({ title, rows, days, tipTitle, trend, partialLabel, label, testId }: BucketPanelProps) => {
  const count = rows[0]?.series.values.length ?? 0;
  const crosshair = useCrosshair(count);
  const hatchId = useId().replace(/:/g, "");
  const index = crosshair.target?.index ?? null;

  return (
    <Card
      title={title}
      className="flex-none"
      data-testid={testId}
      actions={
        <>
          <PartialLegend label={partialLabel} />
          {trend !== null && <TrendToggle trend={trend} />}
        </>
      }
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: one tab stop for the whole panel, so
          ←/→ walk the crosshair along it (§4.5); each row's <svg role="img"> names itself */}
      <div
        aria-description={label}
        tabIndex={count > 0 ? 0 : -1}
        className="flex flex-col gap-3 rounded-chip outline-none focus-visible:ring-1 focus-visible:ring-chart-ref"
        onKeyDown={crosshair.onKeyDown}
        onFocus={crosshair.onFocus}
        onBlur={crosshair.onBlur}
      >
        {rows.map((row) => {
          const last = row.series.futureFrom != null ? row.series.futureFrom - 1 : row.series.values.length - 1;
          return (
            <div
              key={row.key}
              className="flex items-stretch gap-3.5"
              data-testid="traffic-row"
              data-series={row.key}
            >
              <div className="flex w-37.5 flex-none flex-col justify-end pb-0.5">
                <span className="text-row text-chart-ref">{row.label}</span>
                <span className="flex items-baseline gap-1.5">
                  <span className={cn("text-base font-medium tabular-nums", METRIC_INK[row.series.metric].text)}>
                    {row.total}
                  </span>
                  <span className="text-micro text-chart-ref">{row.sub}</span>
                </span>
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="flex h-3 justify-end text-chart-label leading-none text-chart-ref tabular-nums">
                  {peakAvgLabel(peakOf(row.series.values), meanOf(row.series.values, last))}
                </span>
                <ChartFrame
                  count={count}
                  height={ROW_PLOT_PX + 1}
                  label={row.summary}
                  crosshair={crosshair}
                >
                  {({ width }) => (
                    <BucketMarks
                      series={{ ...row.series, days }}
                      width={width}
                      height={ROW_PLOT_PX}
                      hatchId={`${hatchId}-${row.key}`}
                    />
                  )}
                </ChartFrame>
              </div>
            </div>
          );
        })}

        {days.length > 0 && (
          <div className="flex gap-3.5">
            <div className="w-37.5 flex-none" />
            <div className="relative h-3.5 min-w-0 flex-1 text-micro text-chart-ref">
              {days.map((day) => (
                <span
                  key={day.index}
                  className="absolute top-0 pl-1 whitespace-nowrap"
                  style={{ left: `${(day.index / count) * 100}%` }}
                >
                  {day.label}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <Tooltip
        mode="cursor"
        skin={TOOLTIP_SKIN.chart}
        point={crosshair.target?.point ?? null}
      >
        {index === null ? null : (
          <ChartTip
            title={tipTitle(index)}
            rows={rows.map((row) => ({
              label: row.tipLabel,
              value: formatChartValue(row.series.values[index] ?? null),
              swatch: METRIC_INK[row.series.metric].swatch,
            }))}
          />
        )}
      </Tooltip>
    </Card>
  );
};

type BucketPanelProps = {
  title: string;
  rows: readonly PanelRow[];
  /** Where each day starts: dashed separators across every row, and `Fri 6` under the last. */
  days: readonly DayStart[];
  /** The tooltip's title for a bucket: `Sat 7 · 14:00 → 15:00`. */
  tipTitle: (index: number) => string;
  /** The `24h trend` switch, or `null` when no row can carry a trend. */
  trend: TrendSwitch | null;
  /** The words beside the hatched swatch: `current hour`. */
  partialLabel: string;
  /** The whole panel in a few words, for the focusable group. */
  label: string;
  testId?: string;
};
