"use client";

import { AreaSpark } from "@components/ui/AreaSpark";
import { BarSpark } from "@components/ui/BarSpark";
import { MeterBar } from "@components/ui/MeterBar";
import { Pending } from "@components/ui/Pending";
import { Sparkline } from "@components/ui/Sparkline";
import { formatBytes } from "@lib/format";
import { logsHref } from "@lib/logsHref";
import {
  formatHeap,
  formatMs,
  formatPercent,
  formatPool,
  formatRate,
  hasSeries,
  loopShare,
  loopTone,
  poolShare,
  poolTone,
} from "@lib/serviceFormat";
import { cn } from "@lib/utils";
import { SERVICE_TEXT } from "@text/service";
import { SignalTile, TileEmpty } from "./SignalTile";

import type { Tone } from "@components/ui/surface";
import type { NodeRuntime, ServiceSignals } from "@lib/serviceTypes";
import type { RangeKey } from "@lib/timeRange";

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
    {signals !== null && !signals.scraped ? (
      /*
       * One sentence spanning the row, rather than four identical empty boxes.
       *
       * Four of them read as a rendering failure; one reads as an answer — and it is a permanent
       * one, about a service that exposes no `/metrics` at all rather than a range that happens to
       * be quiet.
       */
      /* 100px, matching the tile row: a service nobody scrapes gets one sentence instead of four
         tiles, and the log panel underneath must stay put whichever service the rail is on. */
      <section className="flex h-[100px] flex-none items-center rounded-card border border-work-border bg-work-surface px-3">
        <p className="text-row text-work-text-muted">{SERVICE_TEXT.notScraped}</p>
      </section>
    ) : (
      /* The row's height is pinned rather than left to the content. A tile is 99.5px of fixed rows
         — kicker, value, a 26px chart box — so it would barely move; but "barely" is the whole
         failure mode, and the log panel below must not jump a line every time a range changes. */
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
        />
      </div>
    )}
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
  const points = signals?.throughput.points ?? [];

  return (
    <SignalTile
      kicker={SERVICE_TEXT.throughput}
      value={formatRate(signals?.throughput.value ?? null)}
      unit={SERVICE_TEXT.throughputUnit}
      pending={loading}
    >
      {hasSeries(points) ? (
        <AreaSpark
          values={points.map((point) => point.v)}
          tone="ok"
          label={SERVICE_TEXT.throughputChart(service)}
        />
      ) : (
        <NoChart
          loading={loading}
          error={error}
          points={points}
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
      title={known ? `${SERVICE_TEXT.errorRateHint} · ${SERVICE_TEXT.toErrorLogs}` : SERVICE_TEXT.errorRateHint}
    >
      {known ? (
        <BarSpark
          values={points.map((point) => point.v)}
          tone="error"
          /* A chart of a single 0.4% blip normalised to full height reads as a catastrophe, so the
             scale starts at one percent and only grows past it when something real does. */
          max={1}
          label={SERVICE_TEXT.errorChart(service)}
        />
      ) : (
        <NoChart
          loading={loading}
          error={error}
          points={points}
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
  const points = signals?.p95.points ?? [];
  const value = signals?.p95.value ?? null;

  return (
    <SignalTile
      kicker={SERVICE_TEXT.latency}
      value={formatMs(value)}
      unit={SERVICE_TEXT.latencyUnit}
      pending={loading}
      title={value === null ? undefined : SERVICE_TEXT.latencyReference(formatMs(value))}
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
          className="h-full w-full"
        />
      ) : (
        <NoChart
          loading={loading}
          error={error}
          points={points}
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
const RuntimeTile = ({ runtime, loading }: { runtime: NodeRuntime | null; loading: boolean }) => {
  const heap = formatHeap(runtime?.heapUsedBytes ?? null);
  const lag = runtime?.eventLoopLagMs ?? null;
  const pool = runtime?.pool ?? null;

  return (
    <SignalTile
      kicker={SERVICE_TEXT.runtime}
      value={heap.value}
      unit={heap.unit}
      pending={loading}
      /* The ceiling V8 has allocated, in the title rather than beside the number: the tile has room
         for one figure and two meters, and "318 of 512 MB" is the context for the one it shows. */
      title={heapTitle(runtime)}
    >
      {lag === null && pool === null ? (
        /* "No reading" is a claim, and it cannot be made while the reading is still in flight —
           which this line said in a comment and then printed in the same ink, in the same box, not
           moving, as the claim itself (IKN-57). */
        <TileEmpty>{loading ? <Pending>{SERVICE_TEXT.loading}</Pending> : SERVICE_TEXT.runtimeSilent}</TileEmpty>
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
              title={SERVICE_TEXT.loopHint}
              share={loopShare(lag)}
              tone={loopTone(lag)}
              value={`${formatMs(lag)}ms`}
            />
          )}
          {pool !== null && (
            <MeterRow
              label={SERVICE_TEXT.dbPool}
              title={SERVICE_TEXT.poolHint(pool.waiting)}
              share={poolShare(pool)}
              tone={poolTone(pool)}
              value={formatPool(pool)}
            />
          )}
        </div>
      )}
    </SignalTile>
  );
};

const MeterRow = ({
  label,
  title,
  share,
  tone,
  value,
}: {
  label: string;
  title: string;
  share: number;
  tone: Tone;
  value: string;
}) => (
  <div
    title={title}
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
  </div>
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
}: {
  loading: boolean;
  error: string | null;
  points: { v: number | null }[];
}) => <TileEmpty>{loading ? <Pending>{SERVICE_TEXT.loading}</Pending> : emptyWords(error, points)}</TileEmpty>;

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
const emptyWords = (error: string | null, points: { v: number | null }[]): string => {
  // A request that failed is not a range that was quiet. Reporting the second for the first is the
  // one thing a monitoring tool must never do.
  if (error !== null) return error;

  const known = points.filter((point) => point.v !== null).length;
  return known === 0 ? SERVICE_TEXT.noSamples : SERVICE_TEXT.noSeries;
};
