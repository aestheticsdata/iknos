"use client";

import { INSPECTOR_TAB } from "@lib/interfaces/spanKindTypes";
import { gatesFor, runEvents } from "@lib/runInsights";
import { spanKindOf } from "@lib/spanKind";
import { formatMicros } from "@lib/spanTimeline";
import { cn } from "@lib/utils";
import { TRACES_TEXT } from "@text/traces";
import { useState } from "react";
import { AttributesTab } from "./AttributesTab";
import { ChecksTab } from "./ChecksTab";
import { ContentTab } from "./ContentTab";
import { EventsTab } from "./EventsTab";
import { InfoTab } from "./InfoTab";

import type { InspectorTab } from "@lib/interfaces/spanKindTypes";
import type { SpanRow, Timeline } from "@lib/interfaces/traceSpanTypes";

/**
 * The span under the pointer, or the one picked (IKN-92): what kind it is, then five tabs — the
 * fields that matter for its kind, the checks it concerns, the prompt and response of a model call,
 * the run's events, and every raw attribute (IKN-87's list, kept).
 *
 * The tab is the reader's and survives moving from span to span, so comparing the content of two
 * model calls is two hovers, not four clicks.
 */
export const SpanInspector = ({ span, spans, timeline, tz }: SpanInspectorProps) => {
  const [tab, setTab] = useState<InspectorTab>(INSPECTOR_TAB.info);
  const gates = gatesFor(spans, span);
  const failed = gates.filter((gate) => !gate.passed).length;
  const events = runEvents(spans);

  const count: Partial<Record<InspectorTab, string>> = {
    [INSPECTOR_TAB.checks]: gates.length === 0 ? undefined : failed > 0 ? `${failed} ✕` : String(gates.length),
    [INSPECTOR_TAB.events]: String(events.length),
  };

  return (
    <aside
      aria-label={TRACES_TEXT.inspectorLabel}
      className="flex max-h-[80dvh] min-w-0 flex-[2_1_var(--container-run-inspector)] flex-col overflow-hidden rounded-card border border-work-border bg-work-surface"
      data-testid="span-inspector"
    >
      {span === null ? (
        <p className="px-3 py-4 text-row text-work-text-dim">{TRACES_TEXT.noSpan}</p>
      ) : (
        <>
          <header className="flex flex-none flex-col gap-1 px-3.5 pt-2.75">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-chip border border-work-border-strong px-1.5 text-kicker tracking-kicker text-work-text-dim uppercase">
                {TRACES_TEXT.kind[spanKindOf(span)]}
              </span>
              <h2 className="font-mono text-ui font-semibold break-all text-work-text">{span.name}</h2>
              <span className="text-label text-work-text-dim">{formatMicros(span.durationUs)}</span>
            </div>
            <p className="text-micro text-work-text-dim">{TRACES_TEXT.spanIds(span.spanId, span.parentSpanId)}</p>
          </header>

          <div
            role="tablist"
            aria-label={TRACES_TEXT.inspectorLabel}
            className="flex flex-none gap-0.5 overflow-x-auto border-b border-work-border px-1.5 pt-1.5"
          >
            {Object.values(INSPECTOR_TAB).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={cn(
                  "flex h-9 items-center gap-1.5 border-b-2 px-3.5 text-dense transition-colors duration-150 ease-out",
                  tab === key
                    ? "border-work-accent text-work-text"
                    : "border-transparent text-work-text-dim hover:text-work-text",
                )}
                data-testid="inspector-tab"
                data-tab={key}
              >
                {TRACES_TEXT.tabs[key]}
                {count[key] !== undefined && (
                  <span className="rounded-chip border border-work-border-strong px-1 text-micro text-work-text-dim">
                    {count[key]}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div
            role="tabpanel"
            className="ik-scroll-work min-h-0 flex-1 overflow-y-auto px-3.5 pt-1.5 pb-3.5"
          >
            {tab === INSPECTOR_TAB.info && (
              <InfoTab
                span={span}
                spans={spans}
                timeline={timeline}
              />
            )}
            {tab === INSPECTOR_TAB.checks && <ChecksTab gates={gates} />}
            {tab === INSPECTOR_TAB.content && (
              <ContentTab
                span={span}
                spans={spans}
                tz={tz}
              />
            )}
            {tab === INSPECTOR_TAB.events && (
              <EventsTab
                events={events}
                timeline={timeline}
              />
            )}
            {tab === INSPECTOR_TAB.attributes && <AttributesTab span={span} />}
          </div>
        </>
      )}
    </aside>
  );
};

type SpanInspectorProps = {
  span: SpanRow | null;
  spans: SpanRow[];
  timeline: Timeline;
  /** The reader's zone — the content tab prints when the content goes. */
  tz: string;
};
