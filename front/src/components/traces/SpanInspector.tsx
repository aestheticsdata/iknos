"use client";

import { SURFACE_SCROLL, TONE_TEXT } from "@components/ui/surface";
import { formatCount } from "@lib/format";
import { SPAN_STATUS_CODE } from "@lib/interfaces/traceSpanTypes";
import { formatMicros, spanTone } from "@lib/spanTimeline";
import { attrText, sortedAttrs } from "@lib/traceFormat";
import { cn } from "@lib/utils";
import { TRACES_TEXT } from "@text/traces";

import type { SpanRow, Timeline } from "@lib/interfaces/traceSpanTypes";
import type { ReactNode } from "react";

/** OTLP `Status.code` → the word the list uses for a run, so a span and its run say it alike. */
const STATUS_WORD: Record<number, string> = {
  [SPAN_STATUS_CODE.unset]: TRACES_TEXT.status.unset,
  [SPAN_STATUS_CODE.ok]: TRACES_TEXT.status.ok,
  [SPAN_STATUS_CODE.error]: TRACES_TEXT.status.error,
};

/**
 * The span under the pointer, or the one picked: its timing, its GenAI columns, then every
 * attribute it carried, sorted by key (IKN-87).
 *
 * The promoted GenAI fields come back as their own lines rather than as attributes, because the API
 * moved them out of `attrs` into columns — listing them here keeps the span whole on screen.
 */
export const SpanInspector = ({ span, timeline }: SpanInspectorProps) => (
  <aside
    className={cn(
      "flex w-span-inspector flex-none flex-col overflow-y-auto border-l border-work-border",
      SURFACE_SCROLL.work,
    )}
    data-testid="span-inspector"
  >
    {span === null ? (
      <p className="px-3 py-4 text-row text-work-text-dim">{TRACES_TEXT.noSpan}</p>
    ) : (
      <>
        <header className="border-b border-work-border px-3 py-2">
          <p className="text-kicker tracking-kicker text-work-text-dim uppercase">{TRACES_TEXT.inspectorTitle}</p>
          <p className="font-sans text-ui font-medium break-all text-work-text">{span.name}</p>
        </header>

        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-b border-work-border px-3 py-2 text-row">
          <Field label={TRACES_TEXT.fieldSpanId}>{span.spanId}</Field>
          <Field label={TRACES_TEXT.fieldParent}>{span.parentSpanId ?? TRACES_TEXT.root}</Field>
          <Field label={TRACES_TEXT.fieldStart}>
            {TRACES_TEXT.offset(formatMicros(span.startUs - timeline.startUs))}
          </Field>
          <Field label={TRACES_TEXT.fieldDuration}>{formatMicros(span.durationUs)}</Field>
          <Field label={TRACES_TEXT.fieldStatus}>
            <span className={TONE_TEXT.work[spanTone(span)]}>
              {STATUS_WORD[span.statusCode] ?? TRACES_TEXT.status.unset}
              {span.statusMessage !== null && ` — ${span.statusMessage}`}
            </span>
          </Field>
          {span.genAiOperation !== null && <Field label={TRACES_TEXT.fieldOperation}>{span.genAiOperation}</Field>}
          {span.genAiModel !== null && <Field label={TRACES_TEXT.fieldModel}>{span.genAiModel}</Field>}
          {(span.inputTokens !== null || span.outputTokens !== null) && (
            <Field label={TRACES_TEXT.fieldTokens}>
              {span.inputTokens === null ? TRACES_TEXT.none : formatCount(span.inputTokens)} /{" "}
              {span.outputTokens === null ? TRACES_TEXT.none : formatCount(span.outputTokens)}
            </Field>
          )}
        </dl>

        <section className="px-3 py-2">
          <p className="pb-1 text-kicker tracking-kicker text-work-text-dim uppercase">{TRACES_TEXT.attributes}</p>
          {sortedAttrs(span.attrs).length === 0 ? (
            <p className="text-row text-work-text-dim">{TRACES_TEXT.noAttributes}</p>
          ) : (
            <dl
              className="flex flex-col gap-1 text-row"
              data-testid="span-attributes"
            >
              {sortedAttrs(span.attrs).map(([key, value]) => (
                <div key={key}>
                  <dt className="break-all text-work-text-dim">{key}</dt>
                  <dd className="break-all whitespace-pre-wrap text-work-text">{attrText(value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      </>
    )}
  </aside>
);

const Field = ({ label, children }: FieldProps) => (
  <>
    <dt className="text-work-text-dim">{label}</dt>
    <dd className="min-w-0 break-all text-work-text">{children}</dd>
  </>
);

type SpanInspectorProps = {
  span: SpanRow | null;
  timeline: Timeline;
};

type FieldProps = {
  label: string;
  children: ReactNode;
};
