import { formatDuration } from "@lib/duration";
import { SPAN_STATUS_CODE } from "@lib/interfaces/traceSpanTypes";

import type { Tone } from "@components/ui/surface";
import type { AxisTick, BarBox, SpanRow, Timeline } from "@lib/interfaces/traceSpanTypes";

/**
 * The waterfall's arithmetic (IKN-87): where a span's bar starts and how wide it is, on an axis
 * that runs from the trace's first start to its last end.
 */

/**
 * The narrowest a bar is drawn, in percent. A 200 µs tokenizer step under a 30 s run is 0.0007 %
 * wide — present in the data, invisible on screen. Half a percent keeps every span a mark you can
 * see and hover, at the cost of overstating the tiniest ones, which their label corrects.
 */
export const MIN_BAR_PCT = 0.5;

/** First start to last end, over every span — not the root's, which may be missing or shorter. */
export const timelineOf = (spans: SpanRow[]): Timeline => {
  if (spans.length === 0) return { startUs: 0, durationUs: 0 };

  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const span of spans) {
    start = Math.min(start, span.startUs);
    end = Math.max(end, span.startUs + span.durationUs);
  }
  return { startUs: start, durationUs: end - start };
};

const clampPct = (value: number): number => Math.min(100, Math.max(0, value));

/**
 * A span's bar. A zero-length trace (one instant span) fills the drawing rather than dividing by
 * zero; a bar is never pushed past the right edge by its minimum width.
 */
export const barBox = (span: SpanRow, timeline: Timeline): BarBox => {
  if (timeline.durationUs <= 0) return { leftPct: 0, widthPct: 100 };

  const leftPct = clampPct(((span.startUs - timeline.startUs) / timeline.durationUs) * 100);
  const rawWidth = (span.durationUs / timeline.durationUs) * 100;
  const widthPct = Math.min(Math.max(rawWidth, MIN_BAR_PCT), 100 - leftPct);
  return { leftPct: Math.min(leftPct, 100 - MIN_BAR_PCT), widthPct: Math.max(widthPct, MIN_BAR_PCT) };
};

/** `count + 1` evenly spaced labels from 0 to the trace's length, both ends included. */
export const axisTicks = (timeline: Timeline, count: number): AxisTick[] =>
  Array.from({ length: count + 1 }, (_, i) => ({
    pct: (i / count) * 100,
    offsetUs: Math.round((timeline.durationUs * i) / count),
  }));

/**
 * A microsecond duration in the unit its size calls for: `350µs` under a millisecond, then the
 * app's own `formatDuration` (`4.2ms`, `1.3s`, `2min 05s`), so a span and a log line say a length
 * the same way.
 */
export const formatMicros = (us: number): string =>
  Math.abs(us) < 1000 ? `${Math.round(us)}µs` : formatDuration(us / 1000);

/** A span's status as a tone: error is the only state that earns colour; ok is the accent. */
export const spanTone = (span: SpanRow): Tone => {
  if (span.statusCode === SPAN_STATUS_CODE.error) return "error";
  if (span.statusCode === SPAN_STATUS_CODE.ok) return "ok";
  return "neutral";
};

/** Input plus output tokens, or `null` when neither was reported — absent is not zero. */
export const totalTokens = (input: number | null, output: number | null): number | null =>
  input === null && output === null ? null : (input ?? 0) + (output ?? 0);
