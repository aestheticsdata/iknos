"use client";

import { CONTENT_STATE } from "@lib/interfaces/traceSpanTypes";
import { contentEntries, contentText } from "@lib/spanEvents";
import { TRACES_TEXT } from "@text/traces";

import type { SpanRow } from "@lib/interfaces/traceSpanTypes";

/**
 * The span's content — prompts, answers, system instructions — while Iknos still holds it
 * (IKN-87 v2), else a muted line that says which absence this is: the content expired after its
 * sender's retention, or it was never captured (the app was not at its `full` level).
 *
 * The two absences read differently on purpose. "Expired" says the run was recorded in full and
 * the text is gone by policy; "metadata only" says there never was text to keep. Telling them
 * apart is why the API marks each span at ingest rather than inferring it from missing rows.
 */
export const SpanContent = ({ span }: SpanContentProps) => {
  const entries = contentEntries(span);

  return (
    <section
      className="border-b border-work-border px-3 py-2"
      data-testid="span-content"
      data-content-state={span.contentState}
    >
      <p className="pb-1 text-kicker tracking-kicker text-work-text-dim uppercase">{TRACES_TEXT.content}</p>
      {span.contentState === CONTENT_STATE.expired && (
        <p className="text-row text-work-text-dim">{TRACES_TEXT.contentExpired(span.contentDays)}</p>
      )}
      {span.contentState === CONTENT_STATE.none && (
        <p className="text-row text-work-text-dim">{TRACES_TEXT.contentNone}</p>
      )}
      {span.contentState === CONTENT_STATE.retained &&
        (entries.length === 0 ? (
          <p className="text-row text-work-text-dim">{TRACES_TEXT.contentEmpty}</p>
        ) : (
          <dl className="flex flex-col gap-1.5 text-row">
            {entries.map(([key, value]) => (
              <div key={key}>
                <dt className="break-all text-work-text-dim">{key}</dt>
                <dd className="break-words whitespace-pre-wrap text-work-text">{contentText(value)}</dd>
              </div>
            ))}
          </dl>
        ))}
    </section>
  );
};

type SpanContentProps = {
  span: SpanRow;
};
