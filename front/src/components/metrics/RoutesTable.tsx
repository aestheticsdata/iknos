"use client";

import { DenseTable } from "@components/ui/DenseTable";
import { MeterBar } from "@components/ui/MeterBar";
import { TONE_TEXT } from "@components/ui/surface";
import { costlyRoute, formatLatency, formatShare, hasSamples, p95Tone } from "@lib/metricsFormat";
import { sameRoute } from "@lib/metricsState";
import { ABSENT, formatPercent, formatRate } from "@lib/serviceFormat";
import { cn } from "@lib/utils";
import { METRICS_TEXT } from "@text/metrics";

import type { Column } from "@components/ui/DenseTable";
import type { RouteKey, RouteRow } from "@lib/metricsTypes";

/**
 * The routes table (IKN-23 §1) — `ROUTE · RATE · p50 · p95 · p99 · ERR · SHARE`, worst p95 first.
 *
 * The order is the server's: sorting by an interpolated percentile is part of the answer, not a
 * presentation choice, and a client re-sort would be a second definition of "worst".
 *
 * **A row is selected, not followed.** The whole row answers the pointer, and the route cell holds
 * a real button so the keyboard can reach it — a `<tr>` is not a control (`IssuesTable`'s reasoning).
 * A route with no sample in the range has neither: it is listed, it says so, and there is nothing
 * to open, because a detail of no requests is a panel of em dashes.
 */
export const RoutesTable = ({ rows, thresholdMs, selected, onSelect }: RoutesTableProps) => {
  const costly = costlyRoute(rows, thresholdMs);

  const columns: Column<RouteRow>[] = [
    {
      key: "route",
      header: METRICS_TEXT.colRoute,
      render: (row) => (
        <RouteCell
          row={row}
          selected={sameRoute(row, selected)}
          onSelect={onSelect}
        />
      ),
    },
    {
      key: "rate",
      header: METRICS_TEXT.colRate,
      numeric: true,
      render: (row) => (hasSamples(row) ? formatRate(row.rate) : ABSENT),
    },
    { key: "p50", header: METRICS_TEXT.colP50, numeric: true, render: (row) => formatLatency(row.p50) },
    {
      key: "p95",
      header: METRICS_TEXT.colP95,
      numeric: true,
      render: (row) => <span className={TONE_TEXT.work[p95Tone(row.p95, thresholdMs)]}>{formatLatency(row.p95)}</span>,
    },
    { key: "p99", header: METRICS_TEXT.colP99, numeric: true, render: (row) => formatLatency(row.p99) },
    {
      key: "err",
      header: METRICS_TEXT.colErr,
      numeric: true,
      render: (row) => (
        <span className={cn(row.errorRate !== null && row.errorRate > 0 && TONE_TEXT.work.error)}>
          {row.errorRate === null ? ABSENT : `${formatPercent(row.errorRate)}%`}
        </span>
      ),
    },
    {
      key: "share",
      header: METRICS_TEXT.colShare,
      numeric: true,
      render: (row) => (
        <span
          className="flex h-full w-18 items-center"
          title={METRICS_TEXT.shareLabel(formatShare(row.share))}
        >
          <MeterBar
            share={row.share ?? 0}
            tone={p95Tone(row.p95, thresholdMs) === "error" ? "error" : "info"}
            className="w-full"
          />
        </span>
      ),
    },
  ];

  return (
    <DenseTable
      columns={columns}
      rows={rows}
      rowKey={(row) => `${row.method} ${row.route}`}
      rowAttrs={(row) => ({ "data-testid": "route-row", "data-route": `${row.method} ${row.route}` })}
      rowClassName={(row) =>
        cn(
          "transition-colors duration-150 ease-out",
          hasSamples(row) ? "cursor-pointer hover:bg-work-inset" : "text-work-text-dim",
          // The selection tint gives way to the error ground, as on a log row: the left rule
          // already says where the reader is, and the red band is what makes the row findable.
          sameRoute(row, costly) ? "bg-work-error-bg" : sameRoute(row, selected) && "bg-work-inset",
        )
      }
      onRowClick={(row) => {
        if (hasSamples(row)) onSelect(row);
      }}
      empty={METRICS_TEXT.noRoutes}
      testId="routes-scroll"
      className="min-h-0 flex-1"
    />
  );
};

/** The method, the templated path, and — for an idle route — the reason it cannot be opened. */
const RouteCell = ({ row, selected, onSelect }: RouteCellProps) => {
  const label = (
    <>
      <span className="text-work-text-dim">{row.method}</span> <span className="truncate">{row.route}</span>
    </>
  );

  return (
    <span className="relative -my-1 -ml-2 flex min-w-0 items-center py-1 pl-2">
      {/* The left rule — a log row's idiom. Selection is the brand ink, not `ok`: a selected
          route is not a healthy one. */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-0 left-0 w-0.5 transition-colors duration-150 ease-out",
          selected ? "bg-brand" : "bg-transparent",
        )}
      />
      {hasSamples(row) ? (
        <button
          type="button"
          onClick={(event) => {
            // The row's own handler would select it a second time on the way up.
            event.stopPropagation();
            onSelect(row);
          }}
          aria-pressed={selected}
          title={METRICS_TEXT.selectHint(`${row.method} ${row.route}`)}
          className="flex min-w-0 items-center gap-1 text-left transition-colors duration-150 ease-out hover:text-work-accent"
          data-testid="route-select"
        >
          {label}
        </button>
      ) : (
        <span className="flex min-w-0 items-center gap-1">
          {label}
          <span className="ml-2 flex-none text-micro italic">{METRICS_TEXT.noSamples}</span>
        </span>
      )}
    </span>
  );
};

type RoutesTableProps = {
  rows: RouteRow[];
  /** The p95 past which a figure is coloured — served with the list, the alert engine's own. */
  thresholdMs: number;
  selected: RouteKey | null;
  onSelect: (route: RouteKey) => void;
};

type RouteCellProps = {
  row: RouteRow;
  selected: boolean;
  onSelect: RoutesTableProps["onSelect"];
};
