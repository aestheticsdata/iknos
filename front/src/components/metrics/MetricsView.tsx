"use client";

import { Pending } from "@components/ui/Pending";
import { SURFACE_SCROLL } from "@components/ui/surface";
import { useSelectedService, useTimeRange } from "@lib/chassisState";
import { hasSamples } from "@lib/metricsFormat";
import { sameRoute, useSelectedRoute } from "@lib/metricsState";
import { useRouteDetail, useRouteList } from "@lib/useRouteMetrics";
import { cn } from "@lib/utils";
import { METRICS_TEXT } from "@text/metrics";
import { RouteDetailPanel } from "./detail/RouteDetailPanel";
import { RoutesTable } from "./RoutesTable";

import type { ReactNode } from "react";

/**
 * The metrics view (IKN-23) — "which route costs this service its p95", in one screen.
 *
 * Scoped by the rail like every view, and only meaningful for one service: routes are a property of
 * a service, and a table summed across nineteen would answer nothing — so `all` gets a sentence.
 *
 * **What is open defaults to the worst route.** Nothing selected in the URL means the top row with
 * samples, read but not written: the screen answers its own question on arrival, and the address
 * bar stays clean until the reader actually picks something. A selection that slid out of the list
 * (a narrower range, a route gone quiet) falls back the same way rather than holding a dead panel.
 *
 * The table takes a fixed two fifths of the height and scrolls inside it; the detail takes the
 * rest. Fixed rather than fitted, so a list arriving or growing never moves the detail (§U6).
 */
export const MetricsView = () => {
  const [service] = useSelectedService();
  const [range] = useTimeRange();
  const [picked, select] = useSelectedRoute();

  const list = useRouteList(service, range);
  const rows = list.data?.routes ?? [];

  const pickedRow = rows.find((row) => sameRoute(row, picked) && hasSamples(row));
  const fallback = rows.find(hasSamples) ?? null;
  const open = pickedRow ?? fallback;

  const detail = useRouteDetail({ service, range, route: open });

  if (service === null) return <Notice>{METRICS_TEXT.pickService}</Notice>;
  if (list.data !== null && !list.data.scraped) return <Notice>{METRICS_TEXT.notScraped}</Notice>;

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-2.75 bg-work-ground px-3 py-2.75"
      data-testid="metrics-view"
    >
      <section className="flex h-2/5 min-h-0 flex-none flex-col overflow-hidden rounded-card border border-work-border bg-work-surface">
        <header className="flex flex-none items-center gap-3 border-b border-work-border px-3 py-2">
          <h1 className="font-sans text-ui font-medium text-work-text">
            {METRICS_TEXT.title} · {service}
          </h1>
          <span className="text-kicker tracking-kicker text-work-text-dim uppercase">
            {METRICS_TEXT.rangeLabel(range)}
          </span>
          <span className="ml-auto text-micro text-work-text-dim">{METRICS_TEXT.sortedBy}</span>
        </header>
        {list.data !== null ? (
          <div className={cn("flex min-h-0 flex-1 flex-col", SURFACE_SCROLL.work)}>
            <RoutesTable
              rows={rows}
              thresholdMs={list.data.p95ThresholdMs}
              selected={open}
              onSelect={select}
            />
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
                  data-testid="routes-retry"
                >
                  {METRICS_TEXT.retry}
                </button>
              </>
            ) : (
              <Pending>{METRICS_TEXT.loading}</Pending>
            )}
          </p>
        )}
      </section>

      {open !== null ? (
        <RouteDetailPanel
          service={service}
          route={open}
          range={range}
          detail={detail}
        />
      ) : (
        // The same box the detail would fill, empty — a list with nothing called in the range has
        // nothing to open, and the panel says so instead of vanishing.
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-card border border-work-border bg-work-surface text-row text-work-text-dim">
          {list.data !== null ? METRICS_TEXT.noSamples : null}
        </div>
      )}
    </div>
  );
};

const Notice = ({ children }: NoticeProps) => (
  <div className="flex h-full items-center justify-center bg-work-ground px-3 text-row text-work-text-muted">
    <p data-testid="metrics-notice">{children}</p>
  </div>
);

type NoticeProps = {
  children: ReactNode;
};
