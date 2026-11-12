import { infoRows } from "@lib/spanInfo";

import type { SpanRow, Timeline } from "@lib/interfaces/traceSpanTypes";

/** The fields that matter for the span's kind (IKN-92) — `lib/spanInfo.ts` picks them. */
export const InfoTab = ({ span, spans, timeline }: InfoTabProps) => (
  <dl data-testid="span-info">
    {infoRows(span, spans, timeline).map((row) => (
      <div
        key={row.field}
        className="grid grid-cols-[9rem_minmax(0,1fr)] gap-2.5 border-b border-work-border py-1.75 text-dense"
      >
        <dt className="pt-0.5 text-kicker tracking-kicker text-work-text-dim uppercase">{row.field}</dt>
        <dd className="break-words text-work-text">{row.value}</dd>
      </div>
    ))}
  </dl>
);

type InfoTabProps = {
  span: SpanRow;
  spans: SpanRow[];
  timeline: Timeline;
};
