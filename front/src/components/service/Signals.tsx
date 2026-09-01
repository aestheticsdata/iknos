"use client";

import { AreaSpark } from "@components/ui/AreaSpark";
import { BarSpark } from "@components/ui/BarSpark";
import { MeterBar } from "@components/ui/MeterBar";
import { Pending } from "@components/ui/Pending";
import { Sparkline } from "@components/ui/Sparkline";
import { Tooltip, TooltipBlock } from "@components/ui/Tooltip";
import { formatBytes } from "@lib/format";
import { logsHref } from "@lib/logsHref";
import {
  formatHeap,
  formatMs,
  formatPercent,
  formatPool,
  formatRate,
  hasSeries,
  LOOP_LAG_FULL_MS,
  loopShare,
  loopTone,
  poolShare,
  poolTone,
} from "@lib/serviceFormat";
import { cn } from "@lib/utils";
import { intervalLabel } from "@lib/zone";
import { useZone } from "@lib/zoneState";
import { SERVICE_TEXT } from "@text/service";
import { SignalTile, TileEmpty } from "./SignalTile";

import type { Tone } from "@components/ui/surface";
import type { NodeRuntime, ServiceSignals, SignalPoint } from "@lib/serviceTypes";
import type { RangeKey } from "@lib/timeRange";
import type { ReactNode } from "react";

/**
 * What one interval of a tile's chart says under the pointer.
 *
 * **A 26px tile has no axis and cannot have one**, which until now made the three charts shapes
 * rather than readings: a peak halfway up the box is 40 req/s on this tile and 0.4% on the one
 * beside it, and the only number on screen was the range's own figure above — which is the whole
 * range, not the bar being pointed at. This is where the missing axis went.
 *
 * `null` for an interval that cannot be quoted at all, which is not the same as one whose value is
 * absent: a point the series does not have has no interval to name, while a scraped minute with no
 * answer says so with `ABSENT` beside its own timestamp. The first gets no bubble; the second gets
 * one that reads `— req/s`, which is the honest sentence.
 */
const seriesTip =
  (
    points: SignalPoint[],
    bucketMs: number,
    tz: string,
    unit: string,
    format: (value: number | null) => string,
    context?: string,
  ) =>
  (index: number): ReactNode => {
    const point = points[index];
    if (point === undefined) return null;

    const at = Date.parse(point.t);
    if (!Number.isFinite(at)) return null;

    return (
      <TooltipBlock
        subject={intervalLabel(at, bucketMs, tz)}
        context={context}
        rows={[{ label: unit, value: format(point.v) }]}
      />
    );
  };

/**
 * The four signal tiles — design doc §5.2, and the half of the view that answers "is it well".
 *
 * The three range-scoped ones read one payload; the runtime tile reads the other, because a heap
 * reading is a fact about this instant and has nothing to do with the window the top bar is
 * showing. Putting them in one row anyway is the design's call and the right one: they are four
 * answers to the same question, and only one of them is about time.
 */
export const Signals = ({
  service,
  signals,
  runtime,
  range,
  loading,
  runtimeLoading,
  error,
}: {
  service: string;
  signals: ServiceSignals | null;
  runtime: NodeRuntime | null;
  range: RangeKey;
  /** True while the first answer is in flight. The tiles hold their geometry and say nothing. */
  loading: boolean;
  /** The runtime payload's own state — it is a different route on a different clock. */
  runtimeLoading: boolean;
  /** Set when the request failed. An absence and a failure are not the same sentence. */
  error: string | null;
}) => (
  <div className="flex flex-none flex-col gap-1.5">
    {/* Four tiles, always — an unscraped service included. The full-width sentence this replaces
       made a service switch flash four loaders and then collapse them into one band, which read
       as the row failing to render rather than as an answer. The tiles hold their geometry in
       every state; when nothing is scraped, each one names its own absence (`notScraped`), the
       same way a quiet range or a failed request already speak per tile.

       The row's height is pinned rather than left to the content. A tile is 99.5px of fixed rows
       — kicker, value, a 26px chart box — so it would barely move; but "barely" is the whole
       failure mode, and the log panel below must not jump a line every time a range changes. */}
    <div className="grid h-[100px] grid-cols-4 gap-2.75">
      <ThroughputTile
        service={service}
        signals={signals}
        loading={loading}
        error={error}
      />
      <ErrorRateTile
        service={service}
        signals={signals}
        range={range}
        loading={loading}
        error={error}
      />
      <LatencyTile
        service={service}
        signals={signals}
        loading={loading}
        error={error}
      />
      <RuntimeTile
        runtime={runtime}
        loading={runtimeLoading}
        notScraped={signals !== null && !signals.scraped}
      />
    </div>
  </div>
);

const ThroughputTile = ({
  service,
  signals,
  loading,
  error,
}: {
  service: string;
  signals: ServiceSignals | null;
  loading: boolean;
  error: string | null;
}) => {
  const { tz } = useZone();
  const points = signals?.throughput.points ?? [];

  return (
    <SignalTile
      kicker={SERVICE_TEXT.throughput}
      value={formatRate(signals?.throughput.value ?? null)}
      unit={SERVICE_TEXT.throughputUnit}
      pending={loading}
      hint={SERVICE_TEXT.throughputHint}
    >
      {hasSeries(points) ? (
        <AreaSpark
          values={points.map((point) => point.v)}
          tone="ok"
          label={SERVICE_TEXT.throughputChart(service)}
          tip={seriesTip(points, signals?.bucketMs ?? 0, tz, SERVICE_TEXT.throughputUnit, formatRate)}
        />
      ) : (
        <NoChart
          loading={loading}
          error={error}
          points={points}
          notScraped={signals !== null && !signals.scraped}
        />
      )}
    </SignalTile>
  );
};

/**
 * The one tile that leads somewhere today.
 *
 * A spike in errors leads to the period's error lines — which is the ticket's own example, answered
 * with the view that exists. The panel below is unfiltered, so `level=error` genuinely narrows;
 * that is the test the other three tiles fail.
 */
const ErrorRateTile = ({
  service,
  signals,
  range,
  loading,
  error,
}: {
  service: string;
  signals: ServiceSignals | null;
  range: RangeKey;
  loading: boolean;
  error: string | null;
}) => {
  const { tz } = useZone();
  const points = signals?.errorRate.points ?? [];
  const value = signals?.errorRate.value ?? null;
  const known = points.some((point) => point.v !== null);

  return (
    <SignalTile
      kicker={SERVICE_TEXT.errorRate}
      value={formatPercent(value)}
      unit={SERVICE_TEXT.errorRateUnit}
      pending={loading}
      tone={value !== null && value > 0 ? "error" : "neutral"}
      href={known ? logsHref({ range, values: { service, level: "error" } }) : null}
      hint={known ? `${SERVICE_TEXT.errorRateHint} · ${SERVICE_TEXT.toErrorLogs}` : SERVICE_TEXT.errorRateHint}
    >
      {known ? (
        <BarSpark
          values={points.map((point) => point.v)}
          tone="error"
          /* A chart of a single 0.4% blip normalised to full height reads as a catastrophe, so the
             scale starts at one percent and only grows past it when something real does. */
          max={1}
          label={SERVICE_TEXT.errorChart(service)}
          /* The one chart whose bars are drawn against a fixed floor rather than their own peak,
             which is exactly the kind of scale a reader cannot see and has to be told. */
          tip={seriesTip(points, signals?.bucketMs ?? 0, tz, SERVICE_TEXT.errorRateUnit, formatPercent)}
        />
      ) : (
        <NoChart
          loading={loading}
          error={error}
          points={points}
          notScraped={signals !== null && !signals.scraped}
        />
      )}
    </SignalTile>
  );
};

const LatencyTile = ({
  service,
  signals,
  loading,
  error,
}: {
  service: string;
  signals: ServiceSignals | null;
  loading: boolean;
  error: string | null;
}) => {
  const { tz } = useZone();
  const points = signals?.p95.points ?? [];
  const value = signals?.p95.value ?? null;

  return (
    <SignalTile
      kicker={SERVICE_TEXT.latency}
      value={formatMs(value)}
      unit={SERVICE_TEXT.latencyUnit}
      pending={loading}
      hint={value === null ? undefined : SERVICE_TEXT.latencyReference(formatMs(value))}
    >
      {hasSeries(points) ? (
        <Sparkline
          values={points.map((point) => point.v)}
          tone="warn"
          width={120}
          height={26}
          /* The reference mark §5.2 asks for, pointing at something a reader can name: the window's own
             p95. Every interval above the dash was worse than the range as a whole. The mockup's
             dash sits at a fixed height and refers to nothing at all. */
          reference={value}
          label={SERVICE_TEXT.latencyChart(service)}
          /* This one is drawn against its own minimum — a curve between 405 and 412ms fills the
             box — so without a number the shape is unreadable in the one direction that matters:
             how far up is "up". The dashed rule is named in the header's hint, the bars in this. */
          tip={seriesTip(points, signals?.bucketMs ?? 0, tz, SERVICE_TEXT.latencyUnit, formatMs)}
          className="h-full w-full"
        />
      ) : (
        <NoChart
          loading={loading}
          error={error}
          points={points}
          notScraped={signals !== null && !signals.scraped}
        />
      )}
    </SignalTile>
  );
};

/**
 * The process, not the window — heap, event-loop lag and the connection pool.
 *
 * Inert, and deliberately: its two halves lead to the host panel (IKN-25) and to nothing. The pool
 * bar is the mockup's whole scenario, and what it shows is not a percentage of a configured maximum
 * — the exporter publishes no maximum. It is that nothing is idle, and it goes red only once
 * somebody is queued behind that, which is the request that becomes the 500.
 */
const RuntimeTile = ({
  runtime,
  loading,
  notScraped,
}: {
  runtime: NodeRuntime | null;
  loading: boolean;
  /** Same fact as the chart tiles': no metricsUrl, so there will never be a reading to wait for. */
  notScraped: boolean;
}) => {
  const heap = formatHeap(runtime?.heapUsedBytes ?? null);
  const lag = runtime?.eventLoopLagMs ?? null;
  const pool = runtime?.pool ?? null;

  return (
    <SignalTile
      kicker={SERVICE_TEXT.runtime}
      value={heap.value}
      unit={heap.unit}
      pending={loading}
      /* The ceiling V8 has allocated, on the figure rather than beside it: the tile has room for
         one number and two meters, and "318 of 512 MB" is the context for the one it shows. */
      hint={heapTitle(runtime)}
    >
      {lag === null && pool === null ? (
        /* "No reading" is a claim, and it cannot be made while the reading is still in flight —
           which this line said in a comment and then printed in the same ink, in the same box, not
           moving, as the claim itself (IKN-57). */
        <TileEmpty>
          {loading ? (
            <Pending>{SERVICE_TEXT.loading}</Pending>
          ) : notScraped ? (
            SERVICE_TEXT.notScraped
          ) : (
            SERVICE_TEXT.runtimeSilent
          )}
        </TileEmpty>
      ) : (
        /* The two rows have to fit the tile's 26px chart box, which they only do at a line height
           of 1: `text-micro` inherits the document's 1.5 and two rows of it are 33px, which
           overflows a box that is aligned to its bottom edge — the number above ends up underneath
           them. Centred rather than bottom-aligned, because a pair of meters is the tile's content
           and not a chart sitting on an axis. */
        <div className="flex h-full w-full flex-col justify-center gap-1">
          {lag !== null && (
            <MeterRow
              label={SERVICE_TEXT.loopLag}
              share={loopShare(lag)}
              tone={loopTone(lag)}
              value={`${formatMs(lag)}ms`}
              /* `full at` is the meter's whole scale, and it exists nowhere on the screen: the bar
                 is a share of `LOOP_LAG_FULL_MS`, a constant this tile has never printed. A reader
                 seeing a bar two-thirds across had no way to know whether that was 6ms or 600. */
              tip={
                <TooltipBlock
                  subject={SERVICE_TEXT.loopLag}
                  context={SERVICE_TEXT.loopHint}
                  rows={[
                    { label: SERVICE_TEXT.meterRows.lag, value: `${formatMs(lag)}ms` },
                    { label: SERVICE_TEXT.meterRows.full, value: `${LOOP_LAG_FULL_MS}ms` },
                  ]}
                />
              }
            />
          )}
          {pool !== null && (
            <MeterRow
              label={SERVICE_TEXT.dbPool}
              share={poolShare(pool)}
              tone={poolTone(pool)}
              value={formatPool(pool)}
              /* Three numbers where the row has room for two, and the third is the one that turns
                 the bar red: `10/10` is a pool at capacity, `2 waiting` is the requests queued
                 behind it, and the exporter publishes no maximum for either to be a share of. */
              tip={
                <TooltipBlock
                  subject={SERVICE_TEXT.dbPool}
                  context={SERVICE_TEXT.poolHint(pool.waiting)}
                  rows={[
                    { label: SERVICE_TEXT.meterRows.active, value: pool.active },
                    { label: SERVICE_TEXT.meterRows.idle, value: pool.idle },
                    { label: SERVICE_TEXT.meterRows.waiting, value: pool.waiting },
                  ]}
                />
              }
            />
          )}
        </div>
      )}
    </SignalTile>
  );
};

const MeterRow = ({
  label,
  tip,
  share,
  tone,
  value,
}: {
  label: string;
  /** The block the row shows under the pointer — what the bar is a share of, in numbers. */
  tip: ReactNode;
  share: number;
  tone: Tone;
  value: string;
}) => (
  /* The tooltip's wrapper *is* the row: it takes the classes the `<div>` carried, so the two meters
     keep the geometry they were tuned to — 26px of tile, two rows, line height 1. */
  <Tooltip
    mode="hover"
    content={tip}
    className="flex items-center gap-1.5 text-micro leading-none text-work-text-muted"
  >
    {/* 60px, not 52: `event loop` is ten characters, and at 10px of JetBrains Mono that is exactly
        60. A column an em too narrow wraps it onto a second line, which is how two rows of meters
        became three and climbed over the heap figure above them. */}
    <span className="w-[60px] flex-none whitespace-nowrap">{label}</span>
    <MeterBar
      share={share}
      tone={tone}
    />
    {/* The figure, always — the bar is `aria-hidden` and a colour alone is not a reading. */}
    <span
      className={cn(
        "flex-none whitespace-nowrap transition-[color] duration-150 ease-out",
        tone === "error" ? "text-work-error" : "tabular-nums",
      )}
    >
      {value}
    </span>
  </Tooltip>
);

/** `318 of 512 MB heap`, or nothing to say. */
const heapTitle = (runtime: NodeRuntime | null): string | undefined => {
  if (!runtime || runtime.heapUsedBytes === null || runtime.heapTotalBytes === null) return undefined;
  return `${formatBytes(runtime.heapUsedBytes)} of ${formatBytes(runtime.heapTotalBytes)} allocated`;
};

/**
 * The chart slot when there is no chart — and it holds two different kinds of thing, which is why
 * it is no longer one string (IKN-57).
 *
 * A question while the answer is in flight, a sentence once it is not. The old shape handed four
 * strings to one `<TileEmpty>`, so "reading…" and "One reading — too few for a line." were the same
 * element in the same ink in the same 26px box, one glance apart, and neither moved.
 *
 * Still the same `<TileEmpty>` on both branches, and that is deliberate rather than left over: one
 * element means one line box and one baseline, so nothing shifts at the moment the answer lands.
 * What tells the two apart is the mark, which no answer can produce.
 */
const NoChart = ({
  loading,
  error,
  points,
  notScraped = false,
}: {
  loading: boolean;
  error: string | null;
  points: { v: number | null }[];
  /** The registry row has no metricsUrl — a permanent fact, not a quiet range. */
  notScraped?: boolean;
}) => (
  <TileEmpty>{loading ? <Pending>{SERVICE_TEXT.loading}</Pending> : emptyWords(error, points, notScraped)}</TileEmpty>
);

/**
 * Why a tile has no chart, in the fewest honest words.
 *
 * Two different absences, and they are not interchangeable: the range holds no readings at all, or
 * it holds one and a line needs two.
 *
 * **"Nothing has arrived yet" is no longer one of them**, and taking it out is the ticket. A
 * request that failed is not a range that was quiet, and a request still open is not an answer of
 * any kind — but all three used to come back as a `string` and land in the same paragraph, so the
 * distinction this function's own comment drew was erased by its return type.
 */
const emptyWords = (error: string | null, points: { v: number | null }[], notScraped: boolean): string => {
  // A request that failed is not a range that was quiet. Reporting the second for the first is the
  // one thing a monitoring tool must never do.
  if (error !== null) return error;

  // Nor is an unscraped service a quiet range: "no samples" implies a scrape that found nothing,
  // and this service has no scrape at all.
  if (notScraped) return SERVICE_TEXT.notScraped;

  const known = points.filter((point) => point.v !== null).length;
  return known === 0 ? SERVICE_TEXT.noSamples : SERVICE_TEXT.noSeries;
};
