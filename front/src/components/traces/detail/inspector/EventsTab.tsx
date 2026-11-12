import { Badge } from "@components/ui/Badge";
import { RUN_EVENT } from "@lib/interfaces/spanKindTypes";
import { formatMicros } from "@lib/spanTimeline";
import { TRACES_TEXT } from "@text/traces";

import type { Tone } from "@components/ui/surface";
import type { RunEvent, RunEventKind } from "@lib/interfaces/spanKindTypes";
import type { Timeline } from "@lib/interfaces/traceSpanTypes";

const EVENT_TONE: Record<RunEventKind, Tone> = {
  [RUN_EVENT.start]: "info",
  [RUN_EVENT.checkFailed]: "error",
  [RUN_EVENT.retry]: "warn",
  [RUN_EVENT.decision]: "info",
  [RUN_EVENT.end]: "neutral",
  [RUN_EVENT.running]: "warn",
};

function detailOf(event: RunEvent): string {
  switch (event.kind) {
    case RUN_EVENT.start:
      return TRACES_TEXT.eventDetail.start(event.subject);
    case RUN_EVENT.checkFailed:
      return TRACES_TEXT.eventDetail.checkFailed(event.subject, event.attempt);
    case RUN_EVENT.retry:
      return TRACES_TEXT.eventDetail.retry(event.subject, event.attempt);
    case RUN_EVENT.decision:
      return TRACES_TEXT.eventDetail.decision(event.decision ?? TRACES_TEXT.none);
    case RUN_EVENT.end:
      return TRACES_TEXT.eventDetail.end(event.subject);
    default:
      return TRACES_TEXT.eventDetail.running(event.subject);
  }
}

/** The run's story, derived from its spans (IKN-92): start, failed checks, retries, the review, the end. */
export const EventsTab = ({ events, timeline }: EventsTabProps) => (
  <ol
    className="flex flex-col pt-2"
    data-testid="run-events"
  >
    {events.map((event) => (
      <li
        key={`${event.kind}-${event.spanId}`}
        className="grid grid-cols-[4.5rem_8rem_minmax(0,1fr)] items-start gap-2.5 border-t border-work-border py-2"
      >
        <span className="pt-0.5 text-micro tabular-nums text-work-text-dim">
          {TRACES_TEXT.offset(formatMicros(event.atUs - timeline.startUs))}
        </span>
        <span>
          <Badge tone={EVENT_TONE[event.kind]}>{TRACES_TEXT.event[event.kind]}</Badge>
        </span>
        <span className="text-dense text-work-text-muted">{detailOf(event)}</span>
      </li>
    ))}
  </ol>
);

type EventsTabProps = {
  events: RunEvent[];
  timeline: Timeline;
};
