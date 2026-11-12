"use client";

import { DenseTable } from "@components/ui/DenseTable";
import { runName, shortModel } from "@lib/aiRunFormat";
import { formatCount } from "@lib/format";
import { RUN_STATE } from "@lib/interfaces/aiRunTypes";
import { runPath } from "@lib/routes";
import { formatMicros } from "@lib/spanTimeline";
import { runStartLabel } from "@lib/traceFormat";
import { RUNS_PAGE_SIZE } from "@lib/useAiRuns";
import { useZone } from "@lib/zoneState";
import { TRACES_TEXT } from "@text/traces";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChecksBadge, ReviewBadge, TelemetryBadge } from "../badges/RunBadges";

import type { Column } from "@components/ui/DenseTable";
import type { AiRunList, AiRunSummary } from "@lib/interfaces/aiRunTypes";

/**
 * One row per run, newest first (IKN-91). The whole row opens the run; its name is the real link
 * for the keyboard and for a middle click. A run still going says so in place of its duration.
 */
export const RunTable = ({ list, page, filtered, onPage }: RunTableProps) => {
  const { tz } = useZone();
  const router = useRouter();
  const running = (run: AiRunSummary) => run.state === RUN_STATE.running;

  const columns: Column<AiRunSummary>[] = [
    {
      key: "run",
      header: TRACES_TEXT.colRun,
      render: (run) => (
        <Link
          href={runPath(run.traceId)}
          onClick={(event) => event.stopPropagation()}
          title={TRACES_TEXT.openHint(runName(run.traceId))}
          className="font-medium text-work-text underline-offset-2 transition-colors duration-150 ease-out hover:text-work-accent hover:underline"
          data-testid="run-open"
        >
          {runName(run.traceId)}
        </Link>
      ),
    },
    {
      key: "started",
      header: TRACES_TEXT.colStarted,
      render: (run) => <span className="whitespace-nowrap text-work-text-muted">{runStartLabel(run.startUs, tz)}</span>,
    },
    { key: "service", header: TRACES_TEXT.colService, render: (run) => run.service },
    {
      key: "duration",
      header: TRACES_TEXT.colDuration,
      numeric: true,
      render: (run) => (running(run) ? TRACES_TEXT.running : formatMicros(run.durationUs)),
    },
    {
      key: "steps",
      header: TRACES_TEXT.colSteps,
      numeric: true,
      render: (run) => (running(run) ? TRACES_TEXT.stepsRunning(run.steps) : run.steps),
    },
    {
      key: "tokens",
      header: TRACES_TEXT.colTokens,
      numeric: true,
      render: (run) => formatCount(run.inputTokens + run.outputTokens),
    },
    { key: "checks", header: TRACES_TEXT.colChecks, render: (run) => <ChecksBadge run={run} /> },
    { key: "review", header: TRACES_TEXT.colReview, render: (run) => <ReviewBadge review={run.review} /> },
    {
      key: "telemetry",
      header: TRACES_TEXT.colTelemetry,
      render: (run) => <TelemetryBadge telemetry={run.telemetry} />,
    },
    {
      key: "prompt",
      header: TRACES_TEXT.colPromptModel,
      render: (run) => (
        <span className="whitespace-nowrap text-work-text-muted">
          {[run.prompts.join(" "), run.model === null ? null : shortModel(run.model)].filter(Boolean).join(" · ") ||
            TRACES_TEXT.none}
        </span>
      ),
    },
  ];

  const first = list.total === 0 ? 0 : page * RUNS_PAGE_SIZE + 1;
  const last = Math.min(list.total, (page + 1) * RUNS_PAGE_SIZE);

  return (
    <section
      className="flex min-h-0 flex-none flex-col overflow-hidden rounded-card border border-work-border bg-work-surface"
      data-testid="run-table"
    >
      <h2 className="flex-none border-b border-work-border px-3 py-2 font-sans text-ui font-medium text-work-text">
        {TRACES_TEXT.tableTitle}
      </h2>
      <DenseTable
        columns={columns}
        rows={list.runs}
        rowKey={(run) => run.traceId}
        rowAttrs={(run) => ({ "data-testid": "run-row", "data-trace-id": run.traceId })}
        rowClassName={() => "cursor-pointer transition-colors duration-150 ease-out hover:bg-work-inset"}
        onRowClick={(run) => router.push(runPath(run.traceId))}
        empty={filtered ? TRACES_TEXT.noMatch : TRACES_TEXT.noRuns}
        testId="runs-scroll"
      />
      <footer className="flex flex-none flex-wrap items-center gap-2.5 border-t border-work-border px-3 py-2 text-row text-work-text-dim">
        <span>{TRACES_TEXT.pageOf(first, last, list.total)}</span>
        <span className="flex-1" />
        <PageButton
          label={TRACES_TEXT.previous}
          disabled={page === 0}
          onClick={() => onPage(page - 1)}
        />
        <PageButton
          label={TRACES_TEXT.next}
          disabled={last >= list.total}
          onClick={() => onPage(page + 1)}
        />
      </footer>
    </section>
  );
};

const PageButton = ({ label, disabled, onClick }: PageButtonProps) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className="h-6.5 rounded-control border border-work-border-strong px-3 text-dense text-work-text transition-[background-color,opacity] duration-150 ease-out hover:bg-work-inset disabled:opacity-50"
  >
    {label}
  </button>
);

type RunTableProps = {
  list: AiRunList;
  page: number;
  filtered: boolean;
  onPage: (page: number) => void;
};

type PageButtonProps = {
  label: string;
  disabled: boolean;
  onClick: () => void;
};
