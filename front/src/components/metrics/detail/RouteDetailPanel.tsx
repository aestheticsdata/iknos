"use client";

import { Pending } from "@components/ui/Pending";
import { SURFACE_SCROLL } from "@components/ui/surface";
import { Tooltip } from "@components/ui/Tooltip";
import { logsHref } from "@lib/logsHref";
import { linksToLogs } from "@lib/metricsFormat";
import { cn } from "@lib/utils";
import { METRICS_TEXT } from "@text/metrics";
import Link from "next/link";
import { DetailCard } from "./DetailCard";
import { LatencyDistribution } from "./LatencyDistribution";
import { PercentileChart, PercentileLegend } from "./PercentileChart";
import { RouteSummaryCard } from "./RouteSummaryCard";
import { StatusCodes } from "./StatusCodes";

import type { RouteDetail, RouteKey } from "@lib/metricsTypes";
import type { RangeKey } from "@lib/timeRange";
import type { Polled } from "@lib/usePolledResource";

/**
 * One route in detail (IKN-23 §2) — the percentiles over the range on the left, and the column of
 * three on the right: distribution, status codes, summary.
 *
 * **The geometry is fixed in every state.** Loading, failed and loaded all render the same two
 * columns at the same widths, so selecting a row or changing the range never moves the table
 * above — the Done list's "no layout jump", taken literally.
 */
export const RouteDetailPanel = ({ service, route, range, detail }: RouteDetailPanelProps) => {
  const data = detail.data;
  const title = `${route.method} ${route.route}`;

  const status = detail.error ? (
    <>
      {detail.error}{" "}
      <button
        type="button"
        onClick={detail.reload}
        className="underline underline-offset-2 transition-colors duration-150 ease-out hover:text-work-text"
        data-testid="route-detail-retry"
      >
        {METRICS_TEXT.retry}
      </button>
    </>
  ) : (
    <Pending>{METRICS_TEXT.loading}</Pending>
  );

  return (
    <div
      className="flex min-h-0 flex-1 gap-2.75"
      data-testid="route-detail"
      data-route={title}
    >
      <section className="flex min-w-0 flex-1 flex-col rounded-card border border-work-border bg-work-surface">
        <header className="flex flex-none items-center gap-2.5 border-b border-work-border px-3 py-2">
          <h3 className="min-w-0 flex-1 truncate text-ui font-medium text-work-text">{title}</h3>
          <span className="flex-none text-micro text-work-text-dim">
            {METRICS_TEXT.percentiles} · {METRICS_TEXT.rangeLabel(range)}
          </span>
          <PercentileLegend sloMs={data?.p95ThresholdMs ?? null} />
          {data !== null && linksToLogs(data.summary) && (
            <Tooltip
              mode="hover"
              content={METRICS_TEXT.toLogsHint}
              className="flex-none"
            >
              <Link
                href={logsHref({ range, values: { service, route: route.route } })}
                className="flex-none text-micro text-work-text-muted transition-colors duration-150 ease-out hover:text-work-accent"
                data-testid="route-logs-link"
              >
                {METRICS_TEXT.toLogs}
              </Link>
            </Tooltip>
          )}
        </header>
        <div className="flex min-h-0 flex-1 flex-col px-3 py-2.5">
          {data !== null ? (
            <PercentileChart detail={data} />
          ) : (
            <p className="flex flex-1 items-center justify-center text-row text-work-text-muted">{status}</p>
          )}
        </div>
      </section>

      {/* `min-h-0` and its own scroll: on a short viewport the three cards are taller than what the
          table leaves, and without these the column overflowed into the work pane, which then
          scrolled the whole page a few pixels for nothing. */}
      <div className={cn("flex min-h-0 w-74 flex-none flex-col gap-2.75 overflow-y-auto", SURFACE_SCROLL.work)}>
        {data !== null ? (
          <>
            <LatencyDistribution
              buckets={data.distribution}
              thresholdMs={data.p95ThresholdMs}
            />
            <StatusCodes split={data.status} />
            <RouteSummaryCard
              summary={data.summary}
              thresholdMs={data.p95ThresholdMs}
              scrapeIntervalMs={data.scrapeIntervalMs}
            />
          </>
        ) : (
          <DetailCard
            kicker={METRICS_TEXT.summary}
            testId="route-summary"
            className="min-h-0 flex-1"
          >
            <p className="text-row text-work-text-muted">{status}</p>
          </DetailCard>
        )}
      </div>
    </div>
  );
};

type RouteDetailPanelProps = {
  service: string;
  route: RouteKey;
  range: RangeKey;
  detail: Polled<RouteDetail>;
};
