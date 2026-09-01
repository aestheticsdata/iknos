"use client";

import { Pending } from "@components/ui/Pending";
import { SURFACE_SCROLL, TONE_TEXT } from "@components/ui/surface";
import { SEVERITY_TONE } from "@lib/alertFormat";
import { useAlertSeverity, useAlertView, useOpenAlert } from "@lib/alertState";
import { ALERT_VIEWS, SEVERITIES } from "@lib/alertTypes";
import { useSelectedService } from "@lib/chassisState";
import { useAlerts } from "@lib/useAlerts";
import { cn } from "@lib/utils";
import { ALERTS_TEXT } from "@text/alerts";
import { useState } from "react";
import { AlertCard } from "./AlertCard";

import type { AlertRow, Severity } from "@lib/alertTypes";

/**
 * The alerts view (IKN-15 §1) — every alert, grouped by severity, critical first and always
 * visible.
 *
 * **Grouped here rather than ordered by the server.** The list arrives newest-activity-first
 * because that is the one ordering a keyset cursor can page on; the grouping is a rendering of the
 * page this view already holds in full. At this box's volume the page *is* the list.
 *
 * The modal is not mounted here — it hangs off the chassis so `?alert=` opens it from the rail
 * panel too. This view only writes the parameter.
 *
 * Scoped by the rail, like every other view: a table of the fleet's alerts under a rail that says
 * `pfa-api` would be the one thing on screen answering a different question.
 */

const PAGE = 50;
const CEILING = 200;

export const AlertsView = () => {
  const [service] = useSelectedService();
  const [view, setView] = useAlertView();
  const [severity, setSeverity] = useAlertSeverity();
  const [, openAlert] = useOpenAlert();
  const [limit, setLimit] = useState(PAGE);

  const alerts = useAlerts(service, view, { severity, limit });
  const rows = alerts.rows;
  const hasMore = alerts.data !== null && alerts.data.nextCursor !== null;
  const capped = hasMore && limit >= CEILING;

  const now = Date.now();
  const groups = SEVERITIES.map((level) => ({ level, rows: rows.filter((row) => row.severity === level) }));

  return (
    <div className="flex h-full min-h-0 flex-col bg-work-ground px-3 py-2.75">
      <header className="mb-2.75 flex flex-none flex-wrap items-center gap-3 rounded-card border border-work-border bg-work-surface px-3.25 py-2">
        <h1 className="font-sans text-ui font-medium text-work-text">{ALERTS_TEXT.title}</h1>
        <span className="text-kicker tracking-kicker text-work-text-dim uppercase">{ALERTS_TEXT.tag}</span>

        <fieldset className="flex items-center gap-1">
          <legend className="sr-only">{ALERTS_TEXT.segmentLabel}</legend>
          {ALERT_VIEWS.map((one) => (
            <Segment
              key={one}
              active={view === one}
              onClick={() => setView(one)}
            >
              {ALERTS_TEXT.segments[one]}
            </Segment>
          ))}
        </fieldset>

        <fieldset className="ml-auto flex items-center gap-1">
          <legend className="sr-only">{ALERTS_TEXT.severityLabel}</legend>
          <Segment
            active={severity === null}
            onClick={() => setSeverity(null)}
          >
            {ALERTS_TEXT.allSeverities}
          </Segment>
          {SEVERITIES.map((level) => (
            <Segment
              key={level}
              active={severity === level}
              onClick={() => setSeverity(level)}
            >
              <span className={severity === level ? undefined : TONE_TEXT.work[SEVERITY_TONE[level]]}>{level}</span>
            </Segment>
          ))}
        </fieldset>
      </header>

      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto rounded-card border border-work-border bg-work-surface",
          SURFACE_SCROLL.work,
        )}
      >
        {rows.length === 0 ? (
          <p className="px-3 py-4 text-center text-row text-work-text-muted">
            {alerts.loading ? (
              <Pending>{ALERTS_TEXT.loading}</Pending>
            ) : alerts.error !== null ? (
              alerts.error
            ) : (
              ALERTS_TEXT.emptyTable(ALERTS_TEXT.segments[view], service)
            )}
          </p>
        ) : (
          groups.map(
            (group) =>
              group.rows.length > 0 && (
                <Group
                  key={group.level}
                  level={group.level}
                  rows={group.rows}
                  now={now}
                  onOpen={openAlert}
                />
              ),
          )
        )}

        {capped ? (
          <p className="border-work-border border-t px-3 py-2 text-micro text-work-text-muted">
            {ALERTS_TEXT.loadMore}
          </p>
        ) : (
          hasMore && (
            <button
              type="button"
              onClick={() => setLimit((n) => Math.min(n + PAGE, CEILING))}
              className="w-full border-work-border border-t bg-work-inset px-3 py-2 text-micro text-work-text-muted transition-colors duration-150 ease-out hover:text-work-text"
            >
              {ALERTS_TEXT.loadMore}
            </button>
          )
        )}
      </div>
    </div>
  );
};

/** A severity's block, with its own sticky heading so the group survives a scroll. */
const Group = ({
  level,
  rows,
  now,
  onOpen,
}: {
  level: Severity;
  rows: AlertRow[];
  now: number;
  onOpen: (id: number) => void;
}) => (
  <section>
    <h2
      className={cn(
        "sticky top-0 z-10 border-work-border border-b bg-work-inset px-3 py-1 text-kicker tracking-kicker uppercase",
        TONE_TEXT.work[SEVERITY_TONE[level]],
      )}
    >
      {level} · {rows.length}
    </h2>
    {rows.map((row) => (
      <AlertCard
        key={row.id}
        alert={row}
        now={now}
        onOpen={() => onOpen(row.id)}
      />
    ))}
  </section>
);

const Segment = ({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={cn(
      "rounded-chip px-2 py-0.5 text-row transition-colors duration-150 ease-out",
      active ? "bg-work-inset text-work-text" : "text-work-text-muted hover:text-work-text",
    )}
  >
    {children}
  </button>
);
