"use client";

import { TONE_FILL } from "@components/ui/surface";
import { SPAN_KIND } from "@lib/interfaces/spanKindTypes";
import { EVALUATION_VERDICT } from "@lib/interfaces/traceSpanTypes";
import { evaluationsOf, feedbackOf } from "@lib/spanEvents";
import { attrNumber, isFailed, kindTone, OFFICINA, spanKindOf } from "@lib/spanKind";
import { barBox, formatMicros } from "@lib/spanTimeline";
import { cn } from "@lib/utils";
import { TRACES_TEXT } from "@text/traces";

import type { Timeline, WaterfallLine } from "@lib/interfaces/traceSpanTypes";

/**
 * One span: its name indented by depth, its bar on the run's timeline, its duration in a column of
 * its own (IKN-87).
 *
 * A button, so the keyboard can pick a span; focus previews it like the pointer does. A chip says
 * what the span stands for and the bar takes its kind's ink (IKN-92); a failed span turns red *and*
 * says "failed", so the state never rests on a bar a few pixels wide or on colour alone. A retried
 * attempt carries its number, and a human decision on the span (IKN-87 v2) its glyph and count.
 *
 * The duration is a right-aligned column rather than a label riding the bar: a label beside the
 * bar runs off the drawing for the spans that end the run, which are most of the interesting ones.
 */
export const WaterfallRow = ({ line, timeline, selected, onPick, onHover }: WaterfallRowProps) => {
  const { span, depth, orphan } = line;
  const box = barBox(span, timeline);
  const duration = formatMicros(span.durationUs);
  const hint = TRACES_TEXT.spanHint(span.name, duration);
  const kind = spanKindOf(span);
  const failed = isFailed(span);
  const attempt = attrNumber(span, OFFICINA.attempt);
  const decisions = feedbackOf(span).length;
  /* A gate's overall verdicts only: the per-rule events of a failure would count it once per rule. */
  const verdicts = evaluationsOf(span).filter((evaluation) => evaluation.ruleIndex === null);
  const failedEvaluations = verdicts.filter((evaluation) => evaluation.verdict === EVALUATION_VERDICT.fail).length;
  const passedEvaluations = verdicts.filter((evaluation) => evaluation.verdict === EVALUATION_VERDICT.pass).length;

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
          className="w-11 flex-none rounded-chip border border-work-border-strong text-center text-kicker tracking-kicker text-work-text-dim uppercase"
          data-testid="span-kind"
        >
          {TRACES_TEXT.kind[kind]}
        </span>
        <span className={cn("truncate", failed ? "text-work-error" : "text-work-text")}>{span.name}</span>
        {failed && <span className="flex-none text-micro text-work-error">✕ {TRACES_TEXT.failedLabel}</span>}
        {kind === SPAN_KIND.attempt && attempt !== null && attempt > 1 && (
          <span className="flex-none text-micro text-work-text-dim">{TRACES_TEXT.attemptShort(attempt)}</span>
        )}
        {failedEvaluations > 0 && (
          <span
            className="flex-none text-micro tabular-nums text-work-error"
            title={TRACES_TEXT.markFailedHint(failedEvaluations)}
            data-testid="mark-failed"
          >
            {TRACES_TEXT.markFailed}
            {failedEvaluations}
          </span>
        )}
        {passedEvaluations > 0 && (
          <span
            className="flex-none text-micro tabular-nums text-work-text-dim"
            title={TRACES_TEXT.markPassedHint(passedEvaluations)}
            data-testid="mark-passed"
          >
            {TRACES_TEXT.markPassed}
            {passedEvaluations}
          </span>
        )}
        {decisions > 0 && (
          <span
            className="flex-none text-micro tabular-nums text-work-warn"
            title={TRACES_TEXT.markFeedbackHint(decisions)}
            data-testid="mark-feedback"
          >
            {TRACES_TEXT.markFeedback}
            {decisions}
          </span>
        )}
      </span>

      <span className="relative mx-3 h-full flex-1">
        <span
          className={cn("absolute top-1/2 h-2.5 -translate-y-1/2 rounded-chip", TONE_FILL.work[kindTone(span)])}
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
