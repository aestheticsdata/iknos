"use client";

import { Pending } from "@components/ui/Pending";
import { formatMicros, timelineOf } from "@lib/spanTimeline";
import { waterfallLines } from "@lib/spanTree";
import { useTraceDetail } from "@lib/useTraces";
import { TRACES_TEXT } from "@text/traces";
import { useState } from "react";
import { SpanInspector } from "./SpanInspector";
import { SpanWaterfall } from "./waterfall/SpanWaterfall";

import type { TraceSummary } from "@lib/interfaces/traceSpanTypes";

/**
 * One run: its spans as a nested waterfall, and the attributes of the span under the pointer or
 * picked (IKN-87).
 *
 * **Hover previews, a click pins.** The inspector shows the hovered span while the pointer is on
 * one and falls back to the picked span when it leaves — reading attributes along a row of bars
 * costs no clicks, and the one being compared against stays put.
 *
 * The first span is picked until the reader picks another, so the inspector is never blank on a
 * run that has spans.
 */
export const RunDetail = ({ run }: RunDetailProps) => {
  const detail = useTraceDetail(run);
  const [picked, setPicked] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const spans = detail.data?.spans ?? [];
  const lines = waterfallLines(spans);
  const timeline = timelineOf(spans);
  const shownId = hovered ?? picked ?? lines[0]?.span.spanId ?? null;
  const shown = spans.find((span) => span.spanId === shownId) ?? null;

  return (
    <section
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-work-border bg-work-surface"
      data-testid="run-detail"
    >
      <header className="flex flex-none items-center gap-3 border-b border-work-border px-3 py-2">
        <h2 className="truncate font-sans text-ui font-medium text-work-text">{run.rootName || TRACES_TEXT.unnamed}</h2>
        <span className="text-row tabular-nums text-work-text-muted">{formatMicros(run.durationUs)}</span>
        <span className="text-row text-work-text-dim">{TRACES_TEXT.spanCount(run.spanCount)}</span>
        <span
          className="ml-auto truncate text-micro text-work-text-dim"
          data-testid="run-trace-id"
        >
          {run.traceId}
        </span>
      </header>

      {detail.data === null ? (
        <p className="px-3 py-4 text-row text-work-text-muted">
          {detail.error !== null ? (
            <>
              {detail.error}{" "}
              <button
                type="button"
                onClick={detail.reload}
                className="underline underline-offset-2 transition-colors duration-150 ease-out hover:text-work-text"
              >
                {TRACES_TEXT.retry}
              </button>
            </>
          ) : (
            <Pending>{TRACES_TEXT.loading}</Pending>
          )}
        </p>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            {detail.data.truncated && (
              <p className="flex-none border-b border-work-border px-3 py-1 text-row text-work-warn">
                {TRACES_TEXT.spansTruncated}
              </p>
            )}
            <SpanWaterfall
              lines={lines}
              timeline={timeline}
              selected={shownId}
              onPick={setPicked}
              onHover={setHovered}
            />
          </div>
          <SpanInspector
            span={shown}
            timeline={timeline}
          />
        </div>
      )}
    </section>
  );
};

type RunDetailProps = {
  run: TraceSummary;
};
