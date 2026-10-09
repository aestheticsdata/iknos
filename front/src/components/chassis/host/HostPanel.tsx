"use client";

import { Pending } from "@components/ui/Pending";
import { formatBinaryBytes } from "@lib/format";
import { GAUGE_TONE } from "@lib/hostFormat";
import { HOST_LEVEL } from "@lib/interfaces/hostTypes";
import { HOST_TEXT } from "@text/host";
import { GaugeRow } from "./GaugeRow";
import { LoadRow } from "./LoadRow";

import type { ChartMark } from "@components/ui/interfaces/chartTypes";
import type { HostGauge, HostNow, HostSeries, HostThresholds } from "@lib/interfaces/hostTypes";
import type { RangeKey } from "@lib/timeRange";
import type { Polled } from "@lib/usePolledResource";

type HostPanelProps = {
  now: HostNow | null;
  series: Polled<HostSeries>;
  range: RangeKey;
};

/** `38.2 GiB / 98.3 GiB`, or a dash when `statfs` refused. */
const usedOf = (gauge: HostGauge | undefined): string =>
  gauge === undefined || gauge.usedBytes === null || gauge.totalBytes === null
    ? HOST_TEXT.absent
    : HOST_TEXT.usedOf(formatBinaryBytes(gauge.usedBytes), formatBinaryBytes(gauge.totalBytes));

/** The disk rule's two lines, drawn across the disk chart in the tones they turn the bar. */
const diskMarks = (thresholds: HostThresholds | null): ChartMark[] =>
  thresholds === null
    ? []
    : [
        { value: thresholds.warnPct, tone: GAUGE_TONE[HOST_LEVEL.warning] },
        { value: thresholds.criticalPct, tone: GAUGE_TONE[HOST_LEVEL.critical] },
      ];

/**
 * The machine panel (IKN-25) — disk, memory, CPU and load, in that order.
 *
 * **Disk first**, because it is the one of the three whose crossing does not heal on its own: a
 * CPU spike passes, a full disk stays full until somebody intervenes, and on a VPS it is what
 * takes everything else down with it.
 *
 * The figures are the newest sample and are there whether or not the history has loaded; the
 * charts arrive with the history, and when the range holds nothing the panel says so once, in
 * words, rather than drawing four empty boxes.
 */
export const HostPanel = ({ now, series, range }: HostPanelProps) => {
  const reading = now?.reading ?? null;
  const charts = series.data?.sampled ? series.data : null;
  const thresholds = now?.thresholds ?? series.data?.thresholds ?? null;
  const bucketMs = charts?.bucketMs ?? 0;

  return (
    <div
      className="flex flex-col gap-3"
      data-testid="host-panel"
    >
      {reading === null && <p className="animate-fade text-row text-chassis-text-muted">{HOST_TEXT.noReading}</p>}

      <GaugeRow
        name={HOST_TEXT.disk}
        pct={reading?.disk.pct ?? null}
        tone={GAUGE_TONE[reading?.disk.level ?? HOST_LEVEL.unknown]}
        detail={usedOf(reading?.disk)}
        points={charts?.disk ?? null}
        bucketMs={bucketMs}
        marks={diskMarks(thresholds)}
        note={thresholds === null ? "" : HOST_TEXT.diskLines(thresholds.warnPct, thresholds.criticalPct)}
        range={range}
      />
      <GaugeRow
        name={HOST_TEXT.memory}
        pct={reading?.memory.pct ?? null}
        tone={GAUGE_TONE[reading?.memory.level ?? HOST_LEVEL.unknown]}
        detail={usedOf(reading?.memory)}
        points={charts?.memory ?? null}
        bucketMs={bucketMs}
        note={HOST_TEXT.unwatched}
        range={range}
      />
      <GaugeRow
        name={HOST_TEXT.cpu}
        pct={reading?.cpuPct ?? null}
        tone={GAUGE_TONE[reading?.cpuLevel ?? HOST_LEVEL.unknown]}
        detail={reading === null ? "" : HOST_TEXT.cores(reading.cores)}
        points={charts?.cpu ?? null}
        bucketMs={bucketMs}
        note={HOST_TEXT.unwatched}
        range={range}
      />
      <LoadRow
        reading={reading}
        points={charts?.load ?? null}
        bucketMs={bucketMs}
        range={range}
      />

      <SeriesStatus
        series={series}
        range={range}
      />
    </div>
  );
};

type SeriesStatusProps = {
  series: Polled<HostSeries>;
  range: RangeKey;
};

/** Why there are no charts, said once under the gauges — or nothing, when there are. */
const SeriesStatus = ({ series, range }: SeriesStatusProps) => {
  if (series.loading) {
    return (
      <p className="text-row text-chassis-text-dim">
        <Pending>{HOST_TEXT.loading}</Pending>
      </p>
    );
  }

  if (series.error !== null) {
    return (
      <p className="flex animate-fade items-center gap-2 text-row text-chassis-text-muted">
        {HOST_TEXT.failed}
        <button
          type="button"
          onClick={series.reload}
          className="text-chassis-info underline"
          data-testid="host-retry"
        >
          {HOST_TEXT.retry}
        </button>
      </p>
    );
  }

  if (series.data !== null && !series.data.sampled) {
    return (
      <p
        className="animate-fade text-row text-chassis-text-muted"
        data-testid="host-empty"
      >
        {HOST_TEXT.emptyRange(range)}
      </p>
    );
  }

  return null;
};
