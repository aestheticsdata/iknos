"use client";

import { runName } from "@lib/aiRunFormat";
import { ROUTES } from "@lib/routes";
import { formatMicros, timelineOf } from "@lib/spanTimeline";
import { waterfallLines } from "@lib/spanTree";
import { useRunDetail } from "@lib/useAiRuns";
import { useZone } from "@lib/zoneState";
import { TRACES_TEXT } from "@text/traces";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { LoadState } from "../shared/LoadState";
import { SpanWaterfall } from "../waterfall/SpanWaterfall";
import { SpanInspector } from "./inspector/SpanInspector";
import { RunHeader } from "./RunHeader";
import { WaterfallLegend } from "./WaterfallLegend";

/**
 * One run on its own page (IKN-92): the summary, then the span tree as a waterfall and the
 * inspector beside it.
 *
 * **Hover previews, a click pins** — IKN-87's rule, kept: the inspector follows the pointer along
 * the bars and falls back to the picked span when it leaves. The run's root is picked until the
 * reader picks another, so the inspector opens on the run's checks and events.
 */
export const RunDetailView = ({ traceId }: RunDetailViewProps) => {
  const detail = useRunDetail(traceId);
  const { tz } = useZone();
  const search = useSearchParams().toString();
  const [picked, setPicked] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const spans = detail.data?.spans ?? [];
  const lines = waterfallLines(spans);
  const timeline = timelineOf(spans);
  const pinnedId = picked ?? lines[0]?.span.spanId ?? null;
  const shownId = hovered ?? pinnedId;
  const shown = spans.find((span) => span.spanId === shownId) ?? null;
  const summary = detail.data?.summary ?? null;

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-2.75 overflow-y-auto bg-work-ground px-3 py-2.75"
      data-testid="run-detail"
    >
      <nav className="flex-none text-row text-work-text-dim">
        <Link
          href={search ? `${ROUTES.traces}?${search}` : ROUTES.traces}
          className="transition-colors duration-150 ease-out hover:text-work-text"
          data-testid="back-to-runs"
        >
          {TRACES_TEXT.backToRuns}
        </Link>
        {" / "}
        <span className="text-work-text">{runName(traceId)}</span>
      </nav>

      {detail.data === null ? (
        <section className="rounded-card border border-work-border bg-work-surface">
          <LoadState polled={detail} />
        </section>
      ) : summary === null ? (
        <p className="rounded-card border border-work-border bg-work-surface px-3 py-4 text-row text-work-text-muted">
          {TRACES_TEXT.notFound}
        </p>
      ) : (
        <>
          <RunHeader run={summary} />
          <div className="flex min-h-0 flex-wrap items-start gap-2.75">
            <section
              aria-label={TRACES_TEXT.spansTitle}
              className="flex max-h-[80dvh] min-w-0 flex-[3_1_40rem] flex-col overflow-hidden rounded-card border border-work-border bg-work-surface"
            >
              <header className="flex flex-none items-center gap-2.5 border-b border-work-border px-3 py-2">
                <h2 className="flex-1 font-sans text-ui font-medium text-work-text">{TRACES_TEXT.spansTitle}</h2>
                <span className="text-micro text-work-text-dim">
                  {TRACES_TEXT.spansExtent(spans.length, formatMicros(timeline.durationUs))}
                </span>
              </header>
              {detail.data.truncated && (
                <p className="flex-none border-b border-work-border px-3 py-1 text-row text-work-warn">
                  {TRACES_TEXT.spansTruncated}
                </p>
              )}
              <SpanWaterfall
                lines={lines}
                timeline={timeline}
                selected={pinnedId}
                onPick={setPicked}
                onHover={setHovered}
              />
              <WaterfallLegend />
            </section>
            <SpanInspector
              span={shown}
              spans={spans}
              timeline={timeline}
              tz={tz}
            />
          </div>
        </>
      )}
    </div>
  );
};

type RunDetailViewProps = {
  traceId: string;
};
