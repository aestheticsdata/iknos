"use client";

import { DenseTable } from "@components/ui/DenseTable";
import { Dot } from "@components/ui/Dot";
import { Pending } from "@components/ui/Pending";
import { SURFACE_SCROLL, TONE_TEXT } from "@components/ui/surface";
import { formatCount } from "@lib/format";
import { TRACE_STATUS } from "@lib/interfaces/traceSpanTypes";
import { formatMicros, totalTokens } from "@lib/spanTimeline";
import { runStartLabel } from "@lib/traceFormat";
import { cn } from "@lib/utils";
import { useZone } from "@lib/zoneState";
import { TRACES_TEXT } from "@text/traces";

import type { Column } from "@components/ui/DenseTable";
import type { Tone } from "@components/ui/surface";
import type { TraceList, TraceStatus, TraceSummary } from "@lib/interfaces/traceSpanTypes";
import type { RangeKey } from "@lib/timeRange";
import type { Polled } from "@lib/usePolledResource";

/** A run's verdict as a tone: a failure is the one state that earns colour. */
const STATUS_TONE: Record<TraceStatus, Tone> = {
  [TRACE_STATUS.error]: "error",
  [TRACE_STATUS.ok]: "ok",
  [TRACE_STATUS.unset]: "neutral",
};

/**
 * The runs of one service, newest first — one row per trace (IKN-87).
 *
 * A row is selected, not followed: the whole row answers the pointer, and the run's name is a real
 * button for the keyboard, the metrics table's idiom.
 */
export const RunList = ({ service, range, list, selected, onSelect }: RunListProps) => {
  const { tz } = useZone();
  const runs = list.data?.traces ?? [];

  const columns: Column<TraceSummary>[] = [
    {
      key: "started",
      header: TRACES_TEXT.colStarted,
      render: (run) => <span className="whitespace-nowrap text-work-text-muted">{runStartLabel(run.startUs, tz)}</span>,
    },
    {
      key: "run",
      header: TRACES_TEXT.colRun,
      render: (run) => (
        <button
          type="button"
          title={TRACES_TEXT.openHint(run.rootName || TRACES_TEXT.unnamed)}
          onClick={(event) => {
            // The row's own handler would select it a second time on the way up.
            event.stopPropagation();
            onSelect(run.traceId);
          }}
          className="max-w-full truncate text-left"
          data-testid="run-open"
        >
          {run.rootName || TRACES_TEXT.unnamed}
        </button>
      ),
    },
    { key: "duration", header: TRACES_TEXT.colDuration, numeric: true, render: (run) => formatMicros(run.durationUs) },
    { key: "spans", header: TRACES_TEXT.colSpans, numeric: true, render: (run) => formatCount(run.spanCount) },
    {
      key: "tokens",
      header: TRACES_TEXT.colTokens,
      numeric: true,
      render: (run) => {
        const total = totalTokens(run.inputTokens, run.outputTokens);
        return total === null ? TRACES_TEXT.none : formatCount(total);
      },
    },
    {
      key: "models",
      header: TRACES_TEXT.colModels,
      render: (run) => (
        <span className="truncate text-work-text-muted">
          {run.models.length > 0 ? run.models.join(", ") : TRACES_TEXT.none}
        </span>
      ),
    },
    {
      key: "review",
      header: TRACES_TEXT.colReview,
      render: (run) => {
        const cell = TRACES_TEXT.reviewCell(run.failedEvaluations, run.humanFeedback);
        return (
          <span
            className={cn("whitespace-nowrap", run.failedEvaluations > 0 ? "text-work-error" : "text-work-text-muted")}
            title={TRACES_TEXT.reviewHint}
          >
            {cell || TRACES_TEXT.none}
          </span>
        );
      },
    },
    {
      key: "status",
      header: TRACES_TEXT.colStatus,
      render: (run) => (
        <span className={cn("flex items-center gap-1.5", TONE_TEXT.work[STATUS_TONE[run.status]])}>
          <Dot
            tone={STATUS_TONE[run.status]}
            label={TRACES_TEXT.status[run.status]}
          />
          {TRACES_TEXT.status[run.status]}
        </span>
      ),
    },
  ];

  return (
    <section className="flex h-2/5 min-h-0 flex-none flex-col overflow-hidden rounded-card border border-work-border bg-work-surface">
      <header className="flex flex-none items-center gap-3 border-b border-work-border px-3 py-2">
        <h1 className="font-sans text-ui font-medium text-work-text">
          {TRACES_TEXT.title} · {service}
        </h1>
        <span className="text-kicker tracking-kicker text-work-text-dim uppercase">
          {TRACES_TEXT.rangeLabel(range)}
        </span>
        {list.data !== null && (
          <span className="ml-auto text-micro text-work-text-dim">{TRACES_TEXT.runCount(runs.length)}</span>
        )}
      </header>

      {list.data !== null ? (
        <div className={cn("flex min-h-0 flex-1 flex-col", SURFACE_SCROLL.work)}>
          <DenseTable
            columns={columns}
            rows={runs}
            rowKey={(run) => run.traceId}
            rowAttrs={(run) => ({ "data-testid": "run-row", "data-trace-id": run.traceId })}
            rowClassName={(run) =>
              cn("cursor-pointer hover:bg-work-inset", run.traceId === selected && "bg-work-inset")
            }
            onRowClick={(run) => onSelect(run.traceId)}
            empty={TRACES_TEXT.noRuns}
            testId="runs-scroll"
            className="min-h-0 flex-1 overflow-y-auto"
          />
          {list.data.truncated && <p className="px-3 py-1 text-row text-work-text-dim">{TRACES_TEXT.truncated}</p>}
        </div>
      ) : (
        <p className="px-3 py-4 text-row text-work-text-muted">
          {list.error !== null ? (
            <>
              {list.error}{" "}
              <button
                type="button"
                onClick={list.reload}
                className="underline underline-offset-2 transition-colors duration-150 ease-out hover:text-work-text"
                data-testid="runs-retry"
              >
                {TRACES_TEXT.retry}
              </button>
            </>
          ) : (
            <Pending>{TRACES_TEXT.loading}</Pending>
          )}
        </p>
      )}
    </section>
  );
};

type RunListProps = {
  service: string;
  range: RangeKey;
  list: Polled<TraceList>;
  selected: string | null;
  onSelect: (traceId: string) => void;
};
