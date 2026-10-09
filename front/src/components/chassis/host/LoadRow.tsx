"use client";

import { AreaSpark } from "@components/ui/AreaSpark";
import { TooltipBlock } from "@components/ui/Tooltip";
import { formatLoad } from "@lib/hostFormat";
import { intervalLabel } from "@lib/zone";
import { useZone } from "@lib/zoneState";
import { HOST_TEXT } from "@text/host";

import type { HostReading } from "@lib/interfaces/hostTypes";
import type { SignalPoint } from "@lib/serviceTypes";

type LoadRowProps = {
  reading: HostReading | null;
  points: SignalPoint[] | null;
  bucketMs: number;
  range: string;
};

/**
 * The load averages, as `uptime` prints them, beside the core count they are read against.
 *
 * No bar: a load has no ceiling — 4.0 is a full box on four cores and a quiet one on sixteen — and
 * a bar would have to invent one. The chart is the one-minute average on a zero baseline, and like
 * CPU and memory it is grey, because no alert rule watches it.
 */
export const LoadRow = ({ reading, points, bucketMs, range }: LoadRowProps) => {
  const { tz } = useZone();

  const tip = (index: number) => {
    const point = points?.[index];
    if (point === undefined) return null;

    return (
      <TooltipBlock
        subject={intervalLabel(Date.parse(point.t), bucketMs, tz)}
        rows={[{ label: HOST_TEXT.load, value: point.v === null ? HOST_TEXT.absent : formatLoad(point.v) }]}
      />
    );
  };

  return (
    <section
      className="flex flex-col gap-1.5"
      data-testid="host-gauge"
      data-gauge="load"
    >
      <div className="flex items-center gap-2 text-row">
        <span className="w-16 shrink-0 text-chassis-text">{HOST_TEXT.load}</span>
        <span
          className="flex-1 tabular-nums text-chassis-text-muted"
          data-testid="host-gauge-value"
        >
          {reading === null
            ? HOST_TEXT.absent
            : HOST_TEXT.loadAverages(formatLoad(reading.load1), formatLoad(reading.load5), formatLoad(reading.load15))}
        </span>
        <span className="w-36 shrink-0 text-right tabular-nums text-chassis-text-dim">
          {reading === null ? "" : HOST_TEXT.cores(reading.cores)}
        </span>
      </div>

      {points !== null && (
        <div className="ml-18 h-8 animate-fade">
          <AreaSpark
            values={points.map((point) => point.v)}
            tone="neutral"
            surface="chassis"
            width={480}
            height={32}
            label={HOST_TEXT.chartLabel(HOST_TEXT.load, range)}
            tip={tip}
          />
        </div>
      )}
    </section>
  );
};
