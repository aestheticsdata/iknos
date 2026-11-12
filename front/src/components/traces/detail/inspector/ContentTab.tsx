"use client";

import { Badge } from "@components/ui/Badge";
import { SPAN_KIND } from "@lib/interfaces/spanKindTypes";
import { CONTENT_STATE } from "@lib/interfaces/traceSpanTypes";
import { contentOf, hasContent, messagesOf } from "@lib/runInsights";
import { CONTENT_KEY, spanKindOf } from "@lib/spanKind";
import { runStartLabel } from "@lib/traceFormat";
import { TRACES_TEXT } from "@text/traces";
import { MessageBlock } from "./MessageBlock";

import type { SpanRow } from "@lib/interfaces/traceSpanTypes";

/**
 * A model call's prompt and response (IKN-92), when the run was traced at the `full` level. Iknos
 * keeps that content apart from the span, for the days the sender allowed (IKN-87 v2): while it is
 * kept, the system instructions, the prompt and the response with when they go; once purged, that
 * it was there and for how long; at the metadata level, that it never left the browser.
 */
export const ContentTab = ({ span, spans, tz }: ContentTabProps) => {
  if (spanKindOf(span) !== SPAN_KIND.model) {
    return <p className="py-5.5 text-dense text-work-text-dim">{TRACES_TEXT.contentNotModel}</p>;
  }

  if (span.contentState === CONTENT_STATE.expired) {
    return (
      <Missing
        title={TRACES_TEXT.contentExpiredTitle}
        body={TRACES_TEXT.contentExpiredBody(span.contentDays)}
      />
    );
  }
  if (span.contentState !== CONTENT_STATE.retained) {
    return (
      <Missing
        title={TRACES_TEXT.contentMissingTitle}
        lead={spans.some(hasContent) ? undefined : TRACES_TEXT.contentMissingLead}
        body={TRACES_TEXT.contentMissingBody}
      />
    );
  }

  const system = messagesOf(contentOf(span, CONTENT_KEY.system));
  return (
    <div
      className="flex flex-col gap-2.5 pt-2"
      data-testid="span-content"
    >
      <div className="flex flex-wrap items-center gap-2">
        {span.contentUntilUs !== null && (
          <Badge tone="warn">{TRACES_TEXT.contentExpires(runStartLabel(span.contentUntilUs, tz))}</Badge>
        )}
        <span className="text-micro text-work-text-dim">{TRACES_TEXT.contentRetention(span.contentDays)}</span>
      </div>
      {system.length > 0 && (
        <MessageBlock
          title={TRACES_TEXT.systemInstructions}
          tokens={null}
          messages={system}
        />
      )}
      <MessageBlock
        title={TRACES_TEXT.prompt}
        tokens={span.inputTokens}
        messages={messagesOf(contentOf(span, CONTENT_KEY.input))}
      />
      <MessageBlock
        title={TRACES_TEXT.response}
        tokens={span.outputTokens}
        messages={messagesOf(contentOf(span, CONTENT_KEY.output))}
      />
    </div>
  );
};

const Missing = ({ title, lead, body }: MissingProps) => (
  <div
    className="my-2.5 flex flex-col items-start gap-2 rounded-control border border-dashed border-work-border-strong px-4.5 py-5.5"
    data-testid="content-missing"
  >
    <Badge tone="neutral">{title}</Badge>
    {lead !== undefined && <p className="text-ui font-semibold text-work-text">{lead}</p>}
    <p className="text-dense text-work-text-muted">{body}</p>
  </div>
);

type ContentTabProps = {
  span: SpanRow;
  spans: SpanRow[];
  /** The reader's zone, for when the content goes. */
  tz: string;
};

type MissingProps = {
  title: string;
  lead?: string;
  body: string;
};
