"use client";

import { ChartTip } from "@components/charts/ChartTip";
import { GaugeCurve } from "@components/charts/GaugeCurve";
import { ShareMeter } from "@components/charts/ShareMeter";
import { TONE_TEXT } from "@components/ui/surface";
import { seriesSummary } from "@lib/charts/chartFormat";
import { CHART_SURFACE } from "@lib/charts/chartSurface";
import { METRIC_INK, TONE_METRIC } from "@lib/charts/metricTokens";
import { formatHostPct } from "@lib/hostFormat";
import { isRangeKey, rangeMinutes } from "@lib/timeRange";
import { cn } from "@lib/utils";
import { intervalLabel } from "@lib/zone";
import { useZone } from "@lib/zoneState";
import { HOST_TEXT } from "@text/host";

import type { Tone } from "@components/ui/surface";
import type { GaugeMark } from "@lib/charts/interfaces/chartTypes";
import type { SignalPoint } from "@lib/serviceTypes";

/** CPU, memory and disk are shares of something whole. */
const PERCENT = { min: 0, max: 100 };

type GaugeRowProps = {
  name: string;
  /** The newest reading, 0–100, or `null` when it could not be taken. */
  pct: number | null;
  tone: Tone;
  /** Right of the figure: the bytes behind it, or the core count. */
  detail: string;
  /** The range's points, or `null` while there is no chart to draw — the panel says why, once. */
  points: SignalPoint[] | null;
  bucketMs: number;
  marks?: GaugeMark[];
  /** Under the chart: what its lines are, or why it has no colour. */
  note: string;
  range: string;
};

/**
 * One gauge of the machine panel (IKN-25): the current figure on a bar, the range on a chart
 * beneath it, and a line saying what the colour is answering to.
 *
 * The bar and the chart share a tone, and the tone is the API's verdict — never a comparison made
 * here. Both are drawn on a 0–100 axis, so the height of the line and the length of the bar are
 * the same reading in two tenses.
 */
export const GaugeRow = ({ name, pct, tone, detail, points, bucketMs, marks, note, range }: GaugeRowProps) => {
  const { tz } = useZone();

  const tip = (index: number) => {
    const point = points?.[index];
    if (point === undefined) return null;

    return (
      <ChartTip
        title={intervalLabel(Date.parse(point.t), bucketMs, tz)}
        rows={[
          {
            label: name,
            value: HOST_TEXT.percent(formatHostPct(point.v)),
            swatch: METRIC_INK[TONE_METRIC[tone]].swatch,
          },
        ]}
      />
    );
  };

  return (
    <section
      className="flex flex-col gap-1.5"
      data-testid="host-gauge"
      data-gauge={name}
    >
      <div className="flex items-center gap-2 text-row">
        <span className="w-16 shrink-0 text-chassis-text">{name}</span>
        <span className="flex flex-1 items-center">
          <ShareMeter
            share={(pct ?? 0) / 100}
            metric={TONE_METRIC[tone]}
            surface={CHART_SURFACE.chassis}
          />
        </span>
        <span
          className={cn(
            "w-14 shrink-0 text-right tabular-nums transition-colors duration-150 ease-out",
            TONE_TEXT.chassis[tone],
          )}
          data-testid="host-gauge-value"
        >
          {pct === null ? HOST_TEXT.absent : HOST_TEXT.percent(formatHostPct(pct))}
        </span>
        <span className="w-36 shrink-0 text-right tabular-nums text-chassis-text-dim">{detail}</span>
      </div>

      {points !== null && (
        /* A percentage of something whole, so the axis is pinned 0–100: the height of the curve
           is how full it is (IKN-86). */
        <GaugeCurve
          values={points.map((point) => point.v)}
          metric={TONE_METRIC[tone]}
          height={40}
          spanMs={isRangeKey(range) ? rangeMinutes(range) * 60_000 : bucketMs * points.length}
          domain={PERCENT}
          marks={marks}
          surface={CHART_SURFACE.chassis}
          label={seriesSummary({
            series: HOST_TEXT.chartLabel(name, range),
            span: range,
            total: null,
            values: points.map((point) => point.v),
            bucketName: () => null,
          })}
          tip={tip}
          className="ml-18 animate-fade"
        />
      )}

      <p className="ml-18 text-micro text-chassis-text-dim">{note}</p>
    </section>
  );
};
