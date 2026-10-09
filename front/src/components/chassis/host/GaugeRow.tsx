"use client";

import { AreaSpark } from "@components/ui/AreaSpark";
import { MeterBar } from "@components/ui/MeterBar";
import { BASELINE } from "@components/ui/series";
import { TONE_TEXT } from "@components/ui/surface";
import { TooltipBlock } from "@components/ui/Tooltip";
import { formatHostPct } from "@lib/hostFormat";
import { cn } from "@lib/utils";
import { intervalLabel } from "@lib/zone";
import { useZone } from "@lib/zoneState";
import { HOST_TEXT } from "@text/host";

import type { ChartMark } from "@components/ui/interfaces/chartTypes";
import type { Tone } from "@components/ui/surface";
import type { SignalPoint } from "@lib/serviceTypes";

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
  marks?: ChartMark[];
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
      <TooltipBlock
        subject={intervalLabel(Date.parse(point.t), bucketMs, tz)}
        rows={[{ label: name, value: HOST_TEXT.percent(formatHostPct(point.v)) }]}
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
        <MeterBar
          share={(pct ?? 0) / 100}
          tone={tone}
          surface="chassis"
        />
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
        <div className="ml-18 h-8 animate-fade">
          <AreaSpark
            values={points.map((point) => point.v)}
            tone={tone}
            surface="chassis"
            baseline={BASELINE.percent}
            marks={marks}
            width={480}
            height={32}
            label={HOST_TEXT.chartLabel(name, range)}
            tip={tip}
          />
        </div>
      )}

      <p className="ml-18 text-micro text-chassis-text-dim">{note}</p>
    </section>
  );
};
