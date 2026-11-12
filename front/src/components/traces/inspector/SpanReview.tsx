"use client";

import { TONE_TEXT } from "@components/ui/surface";
import { EVALUATION_VERDICT } from "@lib/interfaces/traceSpanTypes";
import { evaluationsOf, feedbackOf } from "@lib/spanEvents";
import { formatMicros } from "@lib/spanTimeline";
import { cn } from "@lib/utils";
import { TRACES_TEXT } from "@text/traces";

import type { Tone } from "@components/ui/surface";
import type { EvaluationVerdict, SpanRow, Timeline } from "@lib/interfaces/traceSpanTypes";

/** A failed gate is the loud one; a pass is the accent, like a span that said ok. */
const VERDICT_TONE: Record<EvaluationVerdict, Tone> = {
  [EVALUATION_VERDICT.pass]: "ok",
  [EVALUATION_VERDICT.fail]: "error",
  [EVALUATION_VERDICT.other]: "neutral",
};

/**
 * The span's gate evaluations and human decisions, in the inspector (IKN-87 v2).
 *
 * Each evaluation is a chip — verdict word and glyph, never colour alone — with the gate's name,
 * then its explanation when the content is still retained. Each decision names itself and the node
 * it was taken at, then the reviewer's note and edit, also content. Nothing renders for a span
 * that carries neither, so the inspector of a plain step stays as short as it was.
 */
export const SpanReview = ({ span, timeline }: SpanReviewProps) => {
  const evaluations = evaluationsOf(span);
  const feedback = feedbackOf(span);
  const at = (timeUs: number) => TRACES_TEXT.offset(formatMicros(Math.max(0, timeUs - timeline.startUs)));

  return (
    <>
      {evaluations.length > 0 && (
        <section
          className="border-b border-work-border px-3 py-2"
          data-testid="span-evaluations"
        >
          <p className="pb-1 text-kicker tracking-kicker text-work-text-dim uppercase">{TRACES_TEXT.evaluations}</p>
          <ul className="flex flex-col gap-1.5 text-row">
            {evaluations.map((evaluation, i) => (
              <li
                // Two evaluations of one rule at one instant are legitimately alike; position keeps them apart.
                // biome-ignore lint/suspicious/noArrayIndexKey: the list is fixed for a given span.
                key={i}
                data-verdict={evaluation.verdict}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-chip border border-work-border-strong bg-work-inset px-1.5 py-0.5",
                      TONE_TEXT.work[VERDICT_TONE[evaluation.verdict]],
                    )}
                  >
                    {evaluation.verdict === EVALUATION_VERDICT.fail ? TRACES_TEXT.markFailed : TRACES_TEXT.markPassed}{" "}
                    {evaluation.verdict === EVALUATION_VERDICT.other
                      ? (evaluation.label ?? TRACES_TEXT.verdict.other)
                      : TRACES_TEXT.verdict[evaluation.verdict]}
                  </span>
                  <span className="break-all text-work-text">{evaluation.name}</span>
                  {evaluation.ruleIndex !== null && (
                    <span className="text-work-text-dim">{TRACES_TEXT.ruleIndex(evaluation.ruleIndex)}</span>
                  )}
                  {evaluation.score !== null && (
                    <span className="tabular-nums text-work-text-dim">{TRACES_TEXT.score(evaluation.score)}</span>
                  )}
                  <span className="ml-auto tabular-nums text-micro text-work-text-dim">{at(evaluation.timeUs)}</span>
                </div>
                {evaluation.explanation !== null && (
                  <p className="pt-0.5 break-words whitespace-pre-wrap text-work-text-muted">
                    {evaluation.explanation}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {feedback.length > 0 && (
        <section
          className="border-b border-work-border px-3 py-2"
          data-testid="span-feedback"
        >
          <p className="pb-1 text-kicker tracking-kicker text-work-text-dim uppercase">{TRACES_TEXT.feedback}</p>
          <ul className="flex flex-col gap-1.5 text-row">
            {feedback.map((decision, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the list is fixed for a given span.
              <li key={i}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-chip border border-work-border-strong bg-work-inset px-1.5 py-0.5 text-work-warn">
                    {TRACES_TEXT.markFeedback} {decision.decision || TRACES_TEXT.none}
                  </span>
                  {decision.nodeId !== null && (
                    <span className="text-work-text-dim">{TRACES_TEXT.atNode(decision.nodeId)}</span>
                  )}
                  <span className="ml-auto tabular-nums text-micro text-work-text-dim">{at(decision.timeUs)}</span>
                </div>
                {decision.note !== null && (
                  <Quote
                    label={TRACES_TEXT.noteLabel}
                    text={decision.note}
                  />
                )}
                {decision.edit !== null && (
                  <Quote
                    label={TRACES_TEXT.editLabel}
                    text={decision.edit}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
};

const Quote = ({ label, text }: QuoteProps) => (
  <p className="pt-0.5 break-words whitespace-pre-wrap text-work-text-muted">
    <span className="text-work-text-dim">{label}: </span>
    {text}
  </p>
);

type SpanReviewProps = {
  span: SpanRow;
  timeline: Timeline;
};

type QuoteProps = {
  label: string;
  text: string;
};
