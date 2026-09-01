"use client";

import { Card } from "@components/ui/Card";
import { Pending } from "@components/ui/Pending";
import { SURFACE_SCROLL, SURFACE_TEXT_DIM, SURFACE_TEXT_MUTED } from "@components/ui/surface";
import { useOpenAlert } from "@lib/alertState";
import { ROUTES } from "@lib/routes";
import { useAlertCounts } from "@lib/useAlertCounts";
import { RAIL_LIMIT, useAlerts } from "@lib/useAlerts";
import { cn } from "@lib/utils";
import { ALERTS_TEXT } from "@text/alerts";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertCard } from "./AlertCard";

/**
 * The alerts panel, above the issues panel in the work area's right column (IKN-15 §1).
 *
 * `flex-none` and sized by its content, where the issues panel below it takes the remaining
 * height — the mockup's own split, and the right one: an alerts card is usually empty or has two
 * rows in it, and giving it half the column would be reserving space for bad news.
 *
 * Three empty states, never collapsed into one — the rule `IssuesPanel` states at length. On this
 * panel the distinction is the sharpest it gets: "nothing is firing" and "we could not ask" are
 * the same empty box, and one of them means the monitoring is down.
 */
export const AlertsPanel = ({ service }: { service: string }) => {
  const alerts = useAlerts(service, "open", { limit: RAIL_LIMIT });
  /*
   * What fired last, asked only once nothing is firing. A panel that says "nothing" all day on a
   * service that had two incidents this week is hiding the one thing a rail panel is for — and the
   * `RESOLVED` badge on each card keeps the two lists impossible to confuse.
   */
  const recent = useAlerts(service, "resolved", {
    limit: RAIL_LIMIT,
    active: !alerts.loading && alerts.error === null && alerts.rows.length === 0,
  });
  const [, openAlert] = useOpenAlert();
  const search = useSearchParams().toString();

  /*
   * The overflow count comes from the **fleet** provider, so it is scoped differently from the
   * rows above it — and that is deliberate rather than an oversight. The link goes to the alerts
   * view carrying this service, so the honest remainder is this service's; but the provider is
   * fleet-wide chrome. Rather than claim a number it cannot compute, the footer appears only when
   * the page was full, and says how many more this service has by asking for one more row than it
   * shows.
   */
  const rows = alerts.rows.slice(0, RAIL_LIMIT);
  const remaining = alerts.rows.length - rows.length;
  const { counts } = useAlertCounts();

  // One instant for the panel: two cards computing their own would tick a second apart.
  const now = Date.now();

  return (
    <Card
      title={ALERTS_TEXT.panelTitle}
      actions={<span className={cn("text-micro", SURFACE_TEXT_DIM.work)}>{ALERTS_TEXT.panelNote}</span>}
      className="flex flex-none flex-col overflow-hidden"
      bodyClassName={cn("flex max-h-[280px] flex-col overflow-y-auto", SURFACE_SCROLL.work)}
    >
      {rows.length > 0 ? (
        <>
          {rows.map((row) => (
            <AlertCard
              key={row.id}
              alert={row}
              now={now}
              onOpen={() => openAlert(row.id)}
            />
          ))}
          {remaining > 0 && (
            <Link
              href={search ? `${ROUTES.alerts}?${search}` : ROUTES.alerts}
              className={cn(
                "bg-work-inset px-2.75 py-1.75 text-micro transition-colors duration-150 ease-out hover:text-work-text",
                SURFACE_TEXT_MUTED.work,
              )}
            >
              {ALERTS_TEXT.more(remaining)}
            </Link>
          )}
        </>
      ) : recent.rows.length > 0 ? (
        <>
          <p className={cn("px-2.75 pt-2 pb-1 text-kicker tracking-kicker uppercase", SURFACE_TEXT_DIM.work)}>
            {ALERTS_TEXT.recentResolved}
          </p>
          {recent.rows.slice(0, RAIL_LIMIT).map((row) => (
            <AlertCard
              key={row.id}
              alert={row}
              now={now}
              onOpen={() => openAlert(row.id)}
            />
          ))}
        </>
      ) : (
        <Empty
          loading={alerts.loading}
          error={alerts.error}
          // The engine has answered and there is nothing anywhere — a different sentence from
          // "nothing for this service", which is what an empty scoped list means.
          nothingAtAll={counts !== null && counts.critical + counts.warning + counts.info === 0}
          onRetry={alerts.reload}
        />
      )}
    </Card>
  );
};

const Empty = ({
  loading,
  error,
  nothingAtAll,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  nothingAtAll: boolean;
  onRetry: () => void;
}) => (
  <p className={cn("px-2.75 py-3 text-micro leading-relaxed", SURFACE_TEXT_MUTED.work)}>
    {loading ? (
      <Pending>{ALERTS_TEXT.loading}</Pending>
    ) : error !== null ? (
      <>
        {error}{" "}
        <button
          type="button"
          onClick={onRetry}
          className="underline underline-offset-2 transition-colors duration-150 ease-out hover:text-work-text"
        >
          {ALERTS_TEXT.retry}
        </button>
      </>
    ) : nothingAtAll ? (
      ALERTS_TEXT.nothingYet
    ) : (
      ALERTS_TEXT.none
    )}
  </p>
);
