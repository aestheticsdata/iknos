"use client";

import { curvePath } from "@lib/charts/curvePath";
import { MARKER } from "@lib/interfaces/aiRunTypes";
import { CHART_H, CHART_W, rateChart } from "@lib/qualityChart";
import { cn } from "@lib/utils";
import { timeLabel } from "@lib/zone";
import { useZone } from "@lib/zoneState";
import { TRACES_TEXT } from "@text/traces";

import type { QualityDay, QualityMarker } from "@lib/interfaces/aiRunTypes";

const DAY_MS = 86_400_000;

/** Marker labels alternate between two rows so two changes a day apart do not print over each other. */
const MARKER_ROWS = 2;

/**
 * Checks passed and human approval per day (IKN-93), in the IKN-86 inks: checks the views blue,
 * approval the bots amber and dashed, so the two read apart without colour. Version changes are
 * dashed verticals with their label; a pipeline change is a square, a prompt or model change a
 * diamond — the design's legend.
 */
export const QualityChart = ({ days, markers }: QualityChartProps) => {
  const { tz } = useZone();
  const chart = rateChart(days, markers);
  const span = 100 - chart.floor;

  return (
    <section
      className="flex flex-none flex-col gap-2.5 rounded-card border border-work-border bg-work-surface px-3.5 pt-3 pb-3.5"
      data-testid="quality-chart"
    >
      <div className="flex flex-wrap items-center gap-3.5">
        <h2 className="flex-[1_1_15rem] font-sans text-ui font-medium text-work-text">{TRACES_TEXT.chartTitle}</h2>
        <LegendLine
          label={TRACES_TEXT.seriesChecks}
          className="stroke-chart-views"
        />
        <LegendLine
          label={TRACES_TEXT.seriesApproved}
          className="stroke-chart-bots"
          dashed
        />
        <span className="flex items-center gap-1.5 text-label text-work-text-muted">
          <span className="size-2 bg-work-text-dim" />
          {TRACES_TEXT.markerPipeline}
        </span>
        <span className="flex items-center gap-1.5 text-label text-work-text-muted">
          <span className="size-2 rotate-45 bg-work-text-dim" />
          {TRACES_TEXT.markerPrompt}
        </span>
      </div>

      <div
        role="img"
        aria-label={TRACES_TEXT.chartLabel}
        className="relative pt-11 pr-0 pb-5.5 pl-11"
      >
        <div className="absolute top-11 bottom-5.5 left-0 w-9.5 text-micro tabular-nums text-work-text-dim">
          {chart.ticks.map((tick) => (
            <span
              key={tick}
              className="absolute right-0 -translate-y-1/2"
              style={{ top: `${((100 - tick) / span) * 100}%` }}
            >
              {tick}%
            </span>
          ))}
        </div>
        <div className="relative h-quality-chart">
          <svg
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            preserveAspectRatio="none"
            className="absolute inset-0 size-full overflow-visible"
            aria-hidden="true"
          >
            {chart.ticks.map((tick) => (
              <line
                key={tick}
                x1={0}
                x2={CHART_W}
                y1={((100 - tick) / span) * CHART_H}
                y2={((100 - tick) / span) * CHART_H}
                className="stroke-work-border"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {chart.checks.map((points) => (
              <path
                key={`c${points[0].x}`}
                d={curvePath(points)}
                fill="none"
                strokeWidth={2}
                className="stroke-chart-views"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {chart.approved.map((points) => (
              <path
                key={`a${points[0].x}`}
                d={curvePath(points)}
                fill="none"
                strokeWidth={2}
                strokeDasharray="6 4"
                className="stroke-chart-bots"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>

          {chart.markers.map((marker, index) => (
            <div
              key={`${marker.kind}-${marker.label}`}
              className="absolute inset-y-0 w-0 border-l border-dashed border-work-text-dim"
              style={{ left: `${marker.pct}%` }}
              data-testid="quality-marker"
            >
              <span
                className={cn(
                  "absolute left-1 flex items-center gap-1 rounded-chip border border-work-border-strong bg-work-inset px-1.5 text-micro whitespace-nowrap text-work-text",
                  index % MARKER_ROWS === 0 ? "-top-10" : "-top-5",
                  marker.pct > 70 && "right-1 left-auto",
                )}
              >
                <span
                  className={cn("size-1.75 flex-none bg-work-text-dim", marker.kind !== MARKER.pipeline && "rotate-45")}
                />
                {marker.label}
              </span>
            </div>
          ))}

          <div className="absolute inset-x-0 -bottom-5 h-4 text-micro text-work-text-dim">
            {chart.days.map((day) => (
              <span
                key={day.dayStartUs}
                className={cn("absolute", day.pct === 100 ? "-translate-x-full" : day.pct > 0 && "-translate-x-1/2")}
                style={{ left: `${day.pct}%` }}
              >
                {timeLabel(day.dayStartUs / 1000, DAY_MS, tz)}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

const LegendLine = ({ label, className, dashed }: LegendLineProps) => (
  <span className="flex items-center gap-1.5 text-label text-work-text-muted">
    <svg
      width="22"
      height="8"
      aria-hidden="true"
    >
      <line
        x1="0"
        y1="4"
        x2="22"
        y2="4"
        strokeWidth="2"
        strokeDasharray={dashed ? "5 3" : undefined}
        className={className}
      />
    </svg>
    {label}
  </span>
);

type QualityChartProps = {
  days: QualityDay[];
  markers: QualityMarker[];
};

type LegendLineProps = {
  label: string;
  className: string;
  dashed?: boolean;
};
