"use client";

import { Button } from "@components/ui/Button";
import { Pending } from "@components/ui/Pending";
import { cn } from "@lib/utils";
import { timeLabel } from "@lib/zone";
import { useZone } from "@lib/zoneState";
import { LOGS_TEXT } from "@text/logs";
import { useCallback, useMemo, useRef, useState } from "react";

import type { Bucket, Histogram } from "@lib/logTypes";

/**
 * The volume histogram — IKN-12 §2, design doc §5.1 item 2.
 *
 * Presentational and nothing else: it draws the `Histogram` it is handed and says which bucket was
 * clicked. Fetching, retrying and pinning the window all stay in the panel above, because the same
 * query drives the table underneath (`@lib/logQuery` — one builder, three consumers) and a chart
 * holding its own copy of the filters would eventually summarise a different search than the rows
 * it is sitting on top of.
 *
 * **No `surface` prop, on purpose.** §3.1 puts the log stream on the dark ramp — it is the one
 * place in the product where you are genuinely in a terminal — so there is no light variant of this
 * chart to choose between, and a prop offering one would be a decision nobody is allowed to make.
 * Every colour below is `chassis-*` or `histogram-*` for that reason.
 */

/**
 * The three series, bottom to top: info, warn, then error against the empty space above the bar.
 *
 * These are the **histogram's own three** (`--color-histogram-*` in `styles/tokens/colors.css`),
 * not the chassis state ramp. §3.2 gives bars their own error/warn/info in as many words: the ramp
 * is tuned to stay legible as 10.5px text, and these are read as areas of fill thirty pixels tall,
 * which is a different problem. What both sets have in common is that neither is the accent —
 * green is the identity, and §3.2 forbids a chart spending it as a neutral series colour, which is
 * exactly what `info` would be doing here.
 *
 * The classes are written out rather than built as `fill-histogram-${key}`: an interpolated class
 * is one Tailwind's scanner never sees and never emits, and a `<rect>` with no fill rule is not
 * invisible — it is **black**, so the failure would ship as a chart of black bars.
 */
const SERIES = [
  { key: "info", fill: "fill-histogram-info" },
  { key: "warn", fill: "fill-histogram-warn" },
  { key: "error", fill: "fill-histogram-error" },
] as const satisfies readonly { key: keyof Omit<Bucket, "t">; fill: string }[];

/**
 * The viewBox, in units that are **pixels vertically and bucket-widths horizontally**.
 *
 * `preserveAspectRatio="none"` is what lets the chart fill any container width, and the price is
 * that the two axes no longer share a scale. So the box is `0 0 <bucketCount> <CHART_UNITS>` and
 * the element is exactly `CHART_UNITS` pixels tall: y stays honest at 1 unit = 1px, and anything
 * horizontal has to be expressed as a fraction of a bucket rather than in pixels. That is why the
 * gap between bars is a proportion (it narrows as buckets multiply, which is what you want) instead
 * of the mockup's flat 1px, which stretching would have turned into a different width per range.
 */
const BAR_UNITS = 34;
const MARKER_UNITS = 6;
const CHART_UNITS = BAR_UNITS + MARKER_UNITS;
const BAR_GAP = 0.18;

/**
 * A segment that has any lines in it never rounds away to nothing.
 *
 * One error inside four thousand info lines is 0.008px tall and is also the entire reason someone
 * opened this view; drawing it as absent would make the chart lie in the one direction it must not.
 * A non-empty segment therefore gets a floor of one unit, and if those floors push a stack past the
 * top of the chart the whole stack is scaled back to fit rather than clipped — a clipped stack
 * would silently understate the tallest bucket, which is the one being compared against.
 */
const MIN_SEGMENT = 1;

/**
 * **The anomaly rule, in full.** Deliberately arithmetic a reader can redo in their head — IKN-12
 * says no clever detection, and a marker nobody can explain is worse than no marker at all.
 *
 * For each bucket, take the mean error count of *all the other* buckets in the window and subtract
 * it from this bucket's own. The largest of those positive differences wins. Excluding the
 * candidate from its own baseline matters at these window sizes: with sixty buckets a single spike
 * drags the plain mean up by enough to hide itself.
 *
 * It declines to mark anything — draws no marker at all — when any of these is true:
 *  - the window has fewer than `ANOMALY_MIN_BUCKETS` buckets, because "furthest above the rest of
 *    the window" needs a rest of the window to be above;
 *  - the winner is fewer than `ANOMALY_MIN_EXCESS` errors above that mean, which is the floor below
 *    which a marker is just pointing at sampling noise;
 *  - the winner is under `ANOMALY_MIN_RATIO`× the ambient rate, so a window that is uniformly on
 *    fire gets no marker rather than an arbitrary one of its sixty equally bad buckets.
 *
 * The number it reports is the excess, not the count: `+18 err` reads as *eighteen more than usual
 * here*, which is the fact worth putting on the axis.
 */
const ANOMALY_MIN_BUCKETS = 8;
const ANOMALY_MIN_EXCESS = 3;
const ANOMALY_MIN_RATIO = 2;

const findAnomaly = (buckets: readonly Bucket[]): { index: number; excess: number } | null => {
  if (buckets.length < ANOMALY_MIN_BUCKETS) return null;

  const total = buckets.reduce((sum, bucket) => sum + bucket.error, 0);

  let index = -1;
  let excess = 0;
  let ambient = 0;

  for (const [i, bucket] of buckets.entries()) {
    const others = (total - bucket.error) / (buckets.length - 1);
    const above = bucket.error - others;
    if (above > excess) {
      index = i;
      excess = above;
      ambient = others;
    }
  }

  if (index < 0 || excess < ANOMALY_MIN_EXCESS) return null;
  if (buckets[index].error < ANOMALY_MIN_RATIO * ambient) return null;

  return { index, excess: Math.round(excess) };
};

/*
 * The axis label formatter is `timeLabel` in `@lib/zone`, shared with the table's time column.
 *
 * It used to live here, hardcoded to UTC, and the comment it carried is worth keeping because it
 * is still the rule: the axis said `17:18` while the row it pointed at said `15:23`, two clocks
 * for one dataset, one panel apart. Whichever zone wins has to win everywhere here — which is why
 * both surfaces now read one `tz` out of one provider instead of each deciding for itself.
 *
 * Seconds only when a bucket is under a minute, because `02:14:00` repeated across a 24h range is
 * noise, and `02:14` on a 30-second bucket is a label that names two different bars.
 */

/** One drawn bucket: its geometry, its bounds, and the sentence a screen reader gets. */
type Column = {
  key: string;
  /**
   * `null` only if the API sent a `t` that will not parse. The bar still draws — the x-axis must
   * cover the whole range whatever happens — but the button is disabled rather than reached for,
   * since the alternative is `new Date(NaN).toISOString()` throwing and taking the panel with it.
   */
  bounds: { from: string; to: string } | null;
  label: string;
  name: string;
  segments: { fill: string; y: number; height: number }[];
};

export const VolumeHistogram = ({
  histogram,
  loading,
  error,
  onSelectBucket,
  onRetry,
}: {
  histogram: Histogram | null;
  loading: boolean;
  error: string | null;
  onSelectBucket: (bounds: { from: string; to: string }) => void;
  onRetry: () => void;
}) => {
  /**
   * One tab stop for the whole chart, arrows to move inside it — the toolbar pattern.
   *
   * Sixty-odd buckets are sixty-odd tab stops between the query bar and the log table, which is
   * keyboard-*reachable* and keyboard-*hostile*, and this chassis is navigated by keyboard first
   * (§U5). A screen reader in browse mode still walks every bucket, because `tabindex="-1"` takes
   * an element out of the tab order and not out of the accessibility tree.
   */
  const [active, setActive] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  /* One zone for the axis and the rows beneath it — see the note above `Column`. */
  const { tz } = useZone();

  const columns = useMemo<Column[]>(() => {
    if (!histogram) return [];

    const peak = histogram.buckets.reduce((max, b) => Math.max(max, b.error + b.warn + b.info), 0);
    const unit = peak > 0 ? BAR_UNITS / peak : 0;

    return histogram.buckets.map((bucket) => {
      const start = Date.parse(bucket.t);
      const end = start + histogram.bucketMs;
      const usable = Number.isFinite(start);

      const raw = SERIES.map(({ key }) => (bucket[key] === 0 ? 0 : Math.max(MIN_SEGMENT, bucket[key] * unit)));
      const stack = raw.reduce((sum, height) => sum + height, 0);
      const fit = stack > BAR_UNITS ? BAR_UNITS / stack : 1;

      // Walk up from the baseline, so `y` is where the segment just placed begins.
      let y = CHART_UNITS;
      const segments = SERIES.map((series, i) => {
        const height = raw[i] * fit;
        y -= height;
        return { fill: series.fill, y, height };
      });

      const label = timeLabel(start, histogram.bucketMs, tz);

      return {
        key: bucket.t,
        bounds: usable ? { from: new Date(start).toISOString(), to: new Date(end).toISOString() } : null,
        label,
        /*
         * The counts are on the button rather than in the SVG's title: `role="img"` collapses
         * everything under it to one string, so the only way per-bucket detail reaches a screen
         * reader is through the controls layered over the chart. Errors are named first because
         * that is the number the marker is about and the number anyone is here for.
         */
        name: `${label}–${timeLabel(end, histogram.bucketMs, tz)} · ${bucket.error} error · ${bucket.warn} warn · ${bucket.info} info · ${LOGS_TEXT.bucketHint}`,
        segments,
      };
    });
  }, [histogram, tz]);

  const anomaly = useMemo(() => (histogram ? findAnomaly(histogram.buckets) : null), [histogram]);

  const focusBucket = useCallback((index: number, count: number) => {
    const next = Math.max(0, Math.min(count - 1, index));
    setActive(next);
    buttons.current[next]?.focus();
  }, []);

  // A window that shrank under the cursor must not leave the tab stop on a bucket that is gone.
  const roving = Math.min(active, Math.max(columns.length - 1, 0));

  const silent = histogram?.buckets.every((b) => b.error + b.warn + b.info === 0) ?? false;
  const marker = anomaly ? columns[anomaly.index] : undefined;

  return (
    <div className="flex flex-col gap-1">
      {/*
       * Fixed height, and exactly `CHART_UNITS` of it: the viewBox depends on that equality for its
       * 1 unit = 1px vertical scale, and the table below depends on it for not jumping a row every
       * time the chart swaps between loading, empty and drawn. Every state below fills this box.
       */}
      <div className="relative h-[40px]">
        {error ? (
          <div className="absolute inset-0 flex items-center justify-center gap-2">
            {/* The raw message is worth keeping, but on the `title` — the user gets the sentence. */}
            <span
              className="text-micro text-chassis-error"
              title={error}
            >
              {LOGS_TEXT.histogramFailed}
            </span>
            <Button
              variant="quiet"
              onClick={onRetry}
              className="h-6 px-2 text-label"
            >
              {LOGS_TEXT.retry}
            </Button>
          </div>
        ) : !histogram ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-micro text-chassis-text-dim">
              {/* The mark, because this branch and the `noVolume` one below it were the same
                  div, span and classes character for character (IKN-57). */}
              <Pending>{LOGS_TEXT.loading}</Pending>
            </span>
          </div>
        ) : silent ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-micro text-chassis-text-dim">{LOGS_TEXT.noVolume}</span>
          </div>
        ) : (
          <>
            <svg
              viewBox={`0 0 ${columns.length} ${CHART_UNITS}`}
              preserveAspectRatio="none"
              role="img"
              /*
               * Dimmed rather than replaced while a refetch is in flight. Every keystroke in the
               * query bar refetches, and blanking a chart that is about to be redrawn with almost
               * the same shape reads as breakage rather than as work in progress.
               */
              className={cn("pointer-events-none absolute inset-0 h-full w-full", loading && "opacity-60")}
            >
              <title>{LOGS_TEXT.histogramLabel}</title>
              {columns.map((column, index) => (
                <g key={column.key}>
                  {column.segments.map((segment) => (
                    <rect
                      key={segment.fill}
                      x={index + BAR_GAP / 2}
                      y={segment.y}
                      width={1 - BAR_GAP}
                      height={segment.height}
                      className={segment.fill}
                    />
                  ))}
                </g>
              ))}
              {anomaly && (
                /*
                 * A tick the width of the bar it belongs to, in the lane reserved above the bars, so
                 * the words on the axis have something to point at. Not a triangle: horizontal units
                 * are bucket-widths here, so any shape with a width would be sheared by a different
                 * amount at every range. The ▲ lives in the label, where it is a glyph and safe.
                 */
                <rect
                  x={anomaly.index + BAR_GAP / 2}
                  y={1}
                  width={1 - BAR_GAP}
                  height={3}
                  className="fill-chassis-info"
                />
              )}
            </svg>

            {/*
             * The buckets are real buttons layered over the drawing, not `<rect>`s with handlers: a
             * rect cannot be tabbed to, cannot be pressed with the keyboard and has no accessible
             * name. Each one spans the full height of the chart, which is what makes an empty
             * interval clickable dead space instead of a zero-pixel target nobody can hit.
             */}
            <div className="absolute inset-0 flex">
              {columns.map((column, index) => (
                <button
                  key={column.key}
                  type="button"
                  ref={(node) => {
                    buttons.current[index] = node;
                  }}
                  tabIndex={index === roving ? 0 : -1}
                  disabled={column.bounds === null}
                  aria-label={column.name}
                  title={LOGS_TEXT.bucketHint}
                  onFocus={() => setActive(index)}
                  onClick={() => column.bounds && onSelectBucket(column.bounds)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowLeft") focusBucket(index - 1, columns.length);
                    else if (event.key === "ArrowRight") focusBucket(index + 1, columns.length);
                    else if (event.key === "Home") focusBucket(0, columns.length);
                    else if (event.key === "End") focusBucket(columns.length - 1, columns.length);
                    else return;
                    event.preventDefault();
                  }}
                  className="min-w-0 flex-1 transition-colors duration-150 ease-out hover:bg-chassis-text/10"
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/*
       * The axis, and the marker's words, on one fixed-height row — §5.1's
       * `01:59:38 · 02:04 · 02:09 · ▲ 02:14:37 · +18 err`. The ticks are spread by `justify-between`
       * rather than positioned over their bars: at three labels across sixty buckets the difference
       * is a couple of pixels, and the row has to hold its height in every state anyway, which
       * absolute positioning inside a collapsing row does not.
       */}
      {/* The ticks flash with the rows they point at — IKN-47. The row holds the ink and each tick
          holds the flash, which is what lets `ik-zone-flash` mix from `currentcolor` without any of
          them naming a colour. */}
      <div className="flex h-[14px] items-center justify-between text-kicker tabular-nums text-chassis-text-dim">
        {columns.length > 0 && (
          <>
            <span className="ik-zone-flash ik-zone-lift">{columns[0].label}</span>
            {/* Below six buckets the two middle ticks would repeat the first one back at you. */}
            {columns.length >= 6 && (
              <>
                <span className="ik-zone-flash ik-zone-lift">{columns[Math.floor(columns.length / 3)].label}</span>
                <span className="ik-zone-flash ik-zone-lift">
                  {columns[Math.floor((columns.length * 2) / 3)].label}
                </span>
              </>
            )}
            {marker && anomaly ? (
              /*
               * The marker is a button, because the interval it names is the one anybody wants to
               * open next and reaching it otherwise means arrowing across sixty buckets counting
               * bars. `anomalyHint` is carried in the accessible name rather than in a `Tooltip`:
               * this row is fourteen pixels tall at the top of a panel that clips its overflow, so
               * a tip positioned above it would be drawn where it cannot be seen.
               */
              <button
                type="button"
                onClick={() => marker.bounds && onSelectBucket(marker.bounds)}
                disabled={marker.bounds === null}
                title={LOGS_TEXT.bucketHint}
                aria-label={`${marker.label} · ${LOGS_TEXT.anomaly(anomaly.excess)} · ${LOGS_TEXT.anomalyHint}`}
                className="text-chassis-info transition-[filter] duration-150 ease-out hover:brightness-125"
              >
                <span aria-hidden="true">▲ </span>
                {/* Only the timestamp, not the count beside it: the excess did not move when the
                    zone did, and a flash on it would say it had. Its resting ink is the button's
                    `chassis-info`, which is a third one and needs no more configuration than the
                    other two. */}
                <span className="ik-zone-flash ik-zone-lift">{marker.label}</span> · {LOGS_TEXT.anomaly(anomaly.excess)}
              </button>
            ) : (
              <span>{columns[columns.length - 1].label}</span>
            )}
          </>
        )}
      </div>
    </div>
  );
};
