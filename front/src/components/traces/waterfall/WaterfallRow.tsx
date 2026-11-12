"use client";

import { TONE_FILL } from "@components/ui/surface";
import { SPAN_STATUS_CODE } from "@lib/interfaces/traceSpanTypes";
import { barBox, formatMicros, spanTone } from "@lib/spanTimeline";
import { cn } from "@lib/utils";
import { TRACES_TEXT } from "@text/traces";

import type { Timeline, WaterfallLine } from "@lib/interfaces/traceSpanTypes";

/**
 * One span: its name indented by depth, its bar on the run's timeline, its duration in a column of
 * its own (IKN-87).
 *
 * A button, so the keyboard can pick a span; focus previews it like the pointer does. The bar's
 * colour is the span's status — error is the only loud one — and the name of a failed span is
 * red too, so the state never rests on a bar a few pixels wide.
 *
 * The duration is a right-aligned column rather than a label riding the bar: a label beside the
 * bar runs off the drawing for the spans that end the run, which are most of the interesting ones.
 */
export const WaterfallRow = ({ line, timeline, selected, onPick, onHover }: WaterfallRowProps) => {
  const { span, depth, orphan } = line;
  const box = barBox(span, timeline);
  const duration = formatMicros(span.durationUs);
  const hint = TRACES_TEXT.spanHint(span.name, duration);

  return (
    <button
      type="button"
      role="treeitem"
      aria-selected={selected}
      aria-level={depth + 1}
      title={orphan ? `${hint} — ${TRACES_TEXT.orphanHint}` : hint}
      onClick={() => onPick(span.spanId)}
      onMouseEnter={() => onHover(span.spanId)}
      onFocus={() => onHover(span.spanId)}
      onBlur={() => onHover(null)}
      className={cn(
        "flex h-6 w-full items-center border-b border-work-border text-left text-row transition-colors duration-150 ease-out last:border-0 hover:bg-work-inset",
        selected && "bg-work-inset",
      )}
      data-testid="span-row"
      data-span-id={span.spanId}
    >
      <span
        className="flex w-span-names flex-none items-center gap-1 pr-2"
        // Depth is data, so the indent is computed — one token-sized step per level.
        style={{ paddingInlineStart: `calc(var(--spacing-span-indent) * ${depth} + var(--spacing) * 2)` }}
      >
        {orphan && (
          <span
            aria-hidden="true"
            className="flex-none text-work-warn"
          >
            ↳
          </span>
        )}
        <span
          className={cn("truncate", span.statusCode === SPAN_STATUS_CODE.error ? "text-work-error" : "text-work-text")}
        >
          {span.name}
        </span>
      </span>

      <span className="relative mx-3 h-full flex-1">
        <span
          className={cn("absolute top-1/2 h-2.5 -translate-y-1/2 rounded-chip", TONE_FILL.work[spanTone(span)])}
          style={{ left: `${box.leftPct}%`, width: `${box.widthPct}%` }}
        />
      </span>

      <span className="w-16 flex-none pr-3 text-right text-micro tabular-nums text-work-text-muted">{duration}</span>
    </button>
  );
};

type WaterfallRowProps = {
  line: WaterfallLine;
  timeline: Timeline;
  selected: boolean;
  onPick: (spanId: string) => void;
  onHover: (spanId: string | null) => void;
};
