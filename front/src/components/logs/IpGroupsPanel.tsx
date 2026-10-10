"use client";

import { Button } from "@components/ui/Button";
import { Pending } from "@components/ui/Pending";
import { SURFACE_BORDER, SURFACE_TEXT, SURFACE_TEXT_DIM, SURFACE_TEXT_MUTED, TONE_TEXT } from "@components/ui/surface";
import { cn } from "@lib/utils";
import { fullInstant, timeOfDay } from "@lib/zone";
import { useZone } from "@lib/zoneState";
import { LOGS_TEXT } from "@text/logs";

import type { IpGroup, IpGroups } from "@lib/interfaces/ipGroupTypes";

/**
 * Hits per client address over the range — IKN-72's grouping, folded in between the histogram and
 * the stream.
 *
 * **A summary of the one log table, not a second one.** It has no rows of its own to page and no
 * tail: it counts the lines the stream below is showing, under the same filters, and its only
 * action is to narrow that stream — clicking an address sets the `ip` token, and the list, the
 * histogram and the tail follow because they all read the same query.
 *
 * `routes` sits next to `hits` because the pair is what tells a scan from a busy reader: a reader
 * is many hits on few routes, a scanner many hits on many.
 */

type IpGroupsPanelProps = {
  open: boolean;
  groups: IpGroups | null;
  loading: boolean;
  error: string | null;
  /** The `ip` token in force, if any — its row is marked, the way the stream marks the selection. */
  activeIp: string | null;
  onFilter: (ip: string) => void;
  onCopy: (ip: string) => void;
  onRetry: () => void;
};

/** The cell padding the stream uses, so the two tables read as one surface. */
const CELL = "px-2 py-1 transition-colors duration-150 ease-out group-hover:bg-chassis-raised/40";

export const IpGroupsPanel = ({
  open,
  groups,
  loading,
  error,
  activeIp,
  onFilter,
  onCopy,
  onRetry,
}: IpGroupsPanelProps) => (
  /*
   * The fold `WorkArea` uses for the signals row: rows animated from `0fr`, so the panel opens from
   * its own height rather than popping in, and stays mounted while shut so the exit has a box to
   * animate. `inert` keeps a folded panel out of the tab order and the accessibility tree.
   */
  <div
    className={cn(
      "grid min-h-0 shrink-0 transition-[grid-template-rows,opacity] duration-150 ease-out",
      open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
    )}
    inert={!open}
    data-testid="ip-groups"
  >
    <div className="min-h-0 overflow-hidden">
      {/* Capped at a third of a laptop screen: the stream under it is still the view. */}
      <section
        className={cn("ik-scroll max-h-56 overflow-y-auto border-b bg-chassis-inset", SURFACE_BORDER.chassis)}
        aria-label={LOGS_TEXT.ipGroupsLabel}
      >
        <IpGroupsBody
          groups={groups}
          loading={loading}
          error={error}
          activeIp={activeIp}
          onFilter={onFilter}
          onCopy={onCopy}
          onRetry={onRetry}
        />
      </section>
    </div>
  </div>
);

type IpGroupsBodyProps = Omit<IpGroupsPanelProps, "open">;

const IpGroupsBody = ({ groups, loading, error, activeIp, onFilter, onCopy, onRetry }: IpGroupsBodyProps) => {
  const { tz } = useZone();

  if (error) {
    return (
      <Strip>
        <span
          role="alert"
          className={TONE_TEXT.chassis.error}
        >
          {error}
        </span>
        <Button
          variant="quiet"
          onClick={onRetry}
          data-testid="ip-groups-retry"
        >
          {LOGS_TEXT.retry}
        </Button>
      </Strip>
    );
  }

  if (groups === null) {
    return <Strip>{loading && <Pending>{LOGS_TEXT.loading}</Pending>}</Strip>;
  }

  if (groups.groups.length === 0) {
    return <Strip>{LOGS_TEXT.ipGroupsEmpty}</Strip>;
  }

  // Busiest first, so the first row is the scale every bar is drawn against.
  const busiest = groups.groups[0]?.hits ?? 1;

  return (
    <>
      <table className={cn("w-full border-collapse text-row tabular-nums", SURFACE_TEXT.chassis)}>
        <thead>
          <tr>
            <HeaderCell>{LOGS_TEXT.ipGroupsColumns.ip}</HeaderCell>
            {/* The only cell with a width — the bar takes whatever the other three leave. */}
            <HeaderCell className="w-full">{LOGS_TEXT.ipGroupsColumns.hits}</HeaderCell>
            <HeaderCell numeric>{LOGS_TEXT.ipGroupsColumns.routes}</HeaderCell>
            <HeaderCell>{LOGS_TEXT.ipGroupsColumns.lastSeen}</HeaderCell>
          </tr>
        </thead>
        <tbody>
          {groups.groups.map((group) => (
            <IpGroupRow
              key={group.ip}
              group={group}
              share={group.hits / busiest}
              active={group.ip === activeIp}
              tz={tz}
              onFilter={onFilter}
              onCopy={onCopy}
            />
          ))}
        </tbody>
      </table>

      {groups.truncated && <Strip>{LOGS_TEXT.ipGroupsTruncated(groups.groups.length)}</Strip>}
    </>
  );
};

type IpGroupRowProps = {
  group: IpGroup;
  /** Hits as a fraction of the busiest address's, 0–1. */
  share: number;
  active: boolean;
  tz: string;
  onFilter: (ip: string) => void;
  onCopy: (ip: string) => void;
};

const IpGroupRow = ({ group, share, active, tz, onFilter, onCopy }: IpGroupRowProps) => (
  /* The whole row narrows the stream, like a stream row opens its detail; the keyboard path is the
     address button below, whose activation bubbles here as a click. */
  <tr
    onClick={() => onFilter(group.ip)}
    aria-current={active ? "true" : undefined}
    data-testid="ip-group"
    data-ip={group.ip}
    className={cn(
      "group cursor-pointer border-b transition-colors duration-150 ease-out",
      SURFACE_BORDER.chassis,
      active && "bg-chassis-raised",
    )}
  >
    <td className={cn(CELL, "whitespace-nowrap")}>
      <span className="inline-flex items-center gap-2">
        <button
          type="button"
          title={LOGS_TEXT.filterIp}
          aria-label={`${LOGS_TEXT.filterIp} — ${group.ip}`}
          data-testid="ip-group-filter"
          className="text-left"
        >
          {group.ip}
        </button>
        <button
          type="button"
          // Stops here: the row's own click would narrow the stream as well as copy.
          onClick={(event) => {
            event.stopPropagation();
            onCopy(group.ip);
          }}
          title={LOGS_TEXT.copyIp}
          aria-label={`${LOGS_TEXT.copyIp} — ${group.ip}`}
          data-testid="ip-group-copy"
          className={cn(
            "text-kicker transition-colors duration-150 ease-out hover:text-chassis-text",
            SURFACE_TEXT_DIM.chassis,
          )}
        >
          {LOGS_TEXT.copy}
        </button>
      </span>
    </td>

    <td className={CELL}>
      <span className="flex items-center gap-2">
        <span className="w-12 shrink-0 text-right">{group.hits}</span>
        {/* The bar is the number made visible: the gap between the first address and the second is
            what a scan looks like, and reading it off two numbers takes arithmetic. A percentage of
            a drawing, so an inline width rather than a class. */}
        <span
          aria-hidden="true"
          className="h-1.5 flex-1"
        >
          <span
            className="block h-full rounded-full bg-chassis-accent/60 transition-[width] duration-150 ease-out"
            style={{ width: `${Math.max(share * 100, 1)}%` }}
          />
        </span>
      </span>
    </td>

    <td className={cn(CELL, "text-right whitespace-nowrap", SURFACE_TEXT_MUTED.chassis)}>{group.routes}</td>

    <td
      className={cn(CELL, "whitespace-nowrap", SURFACE_TEXT_MUTED.chassis)}
      title={fullInstant(group.lastSeen, tz)}
    >
      {/* Lifted out of the zone dim like every other timestamp on the panel — IKN-47/49. */}
      <span className="ik-zone-flash ik-zone-lift">{timeOfDay(group.lastSeen, tz)}</span>
    </td>
  </tr>
);

type HeaderCellProps = { numeric?: boolean; className?: string; children: React.ReactNode };

const HeaderCell = ({ numeric, className, children }: HeaderCellProps) => (
  <th
    scope="col"
    className={cn(
      // `z-45` and `ik-zone-dim-box` for `LogTable`'s reason: the lifted timestamps in the rows sit
      // at `z-40` and would otherwise scroll through the heading.
      "sticky top-0 z-[45] ik-zone-dim-box border-b bg-chassis-surface px-2 py-1 text-left text-kicker tracking-kicker whitespace-nowrap uppercase",
      SURFACE_BORDER.chassis,
      SURFACE_TEXT_DIM.chassis,
      numeric && "text-right",
      className,
    )}
  >
    {children}
  </th>
);

type StripProps = { children: React.ReactNode };

const Strip = ({ children }: StripProps) => (
  <div
    className={cn("flex min-h-9 items-center justify-center gap-3 px-2 py-2 text-row", SURFACE_TEXT_DIM.chassis)}
    data-testid="ip-groups-strip"
  >
    {children}
  </div>
);
