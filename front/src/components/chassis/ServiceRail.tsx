"use client";

import { Pending } from "@components/ui/Pending";
import { Sparkline } from "@components/ui/Sparkline";
import { TONE_FILL, TONE_TEXT } from "@components/ui/surface";
import { useSelectedService } from "@lib/chassisState";
import { ROUTES } from "@lib/routes";
import { useAlertCounts } from "@lib/useAlertCounts";
import { useIssueCounts } from "@lib/useIssues";
import { useLogout } from "@lib/useLogout";
import { CHASSIS_TEXT } from "@text/chassis";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { IngestCard } from "./IngestCard";

import type { Tone } from "@components/ui/surface";
import type { Service, ServiceHealth } from "@lib/services";

/**
 * Probe state → dot tone. `stale` is warn, not error: the service may be fine — it is the
 * *answer* that stopped arriving, and amber is the colour of "go look", not "it is down".
 */
const HEALTH_TONE: Record<ServiceHealth["status"], Tone> = { ok: "ok", error: "error", stale: "warn" };

/**
 * The views this application can fill. Metrics and alerts join the list with IKN-23 and IKN-15.
 *
 * There is no `service` row: it led to a screen that was this one with a header on top, and the
 * header now arrives with the selection instead. Picking a service in the list above *is* opening
 * the service view.
 *
 * `short` is the collapsed rail's two characters and `badge` names *what kind of thing* sits at
 * the right of the expanded row. For `logs` it is the shortcut letter. For `issues` and `alerts`
 * it is **live data** — a count — which is a change of kind rather than of value, and the two
 * counts are not even the same kind of claim: the issues badge is a quantity and the alerts badge
 * is a warning, so one is neutral and the other is red.
 *
 * Three renderings is where a `view.key === "issues"` ternary stopped being readable, which is why
 * the kind is a field rather than a condition.
 */
const VIEWS = [
  { key: "logs", label: CHASSIS_TEXT.viewLogs, href: ROUTES.logs, short: "L", badge: "shortcut" },
  { key: "issues", label: CHASSIS_TEXT.viewIssues, href: ROUTES.issues, short: "IS", badge: "issues" },
  { key: "alerts", label: CHASSIS_TEXT.viewAlerts, href: ROUTES.alerts, short: "AL", badge: "alerts" },
] as const;

/**
 * Two characters, uppercased — the rail's collapsed form.
 *
 * The registry names services after their pm2 processes, so most of them are compound:
 * `pfa-api`, `pfa-front`, `iknos-api`, `iknos-web`. Taking the first two *characters* of those
 * gives `PF PF IK IK` — the app, twice, which is the one thing the rail must never say. Taking the
 * initial of each of the first two parts gives `PA PF IA IW`, which separates them.
 *
 * A single-part name (`zeus`, `bkmk`) has no second initial to take, so it falls back to its first
 * two characters. Two collide only for services sharing both an app and a first letter of the part
 * — `pfa-api` against a future `pfa-admin` — and those keep their full name in the title and in the
 * accessibility tree, which is the answer for the collapsed rail generally: it is a scanning aid,
 * not an identifier.
 */
const monogram = (name: string) => {
  const parts = name.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const initials = parts.length > 1 ? parts[0][0] + parts[1][0] : name;
  return initials.slice(0, 2).toUpperCase();
};

/**
 * The service rail — selection scopes every view.
 *
 * **The dot and the sparkline are earned, not decorative** (IKN-8). The dot exists only for a
 * service whose health endpoint has actually been probed — `health` is null otherwise, and the
 * rail draws nothing rather than a reassuring green. The sparkline is log volume over the last
 * hour, which every collected service truthfully has — sixty zeros included. A paused service
 * stays dimmed and labelled rather than given a grey dot that reads as "down": `enabled` is a
 * decision, not a measurement.
 *
 * **Below `--breakpoint-rail` it collapses to 52px** — §breakpoints. The names are replaced by
 * monograms, not truncated: 36px of content clips `worldweathr` at `worldw`, and three services
 * whose names share a prefix would then be indistinguishable *and* look like a rendering bug. Every
 * row keeps its full label in the accessibility tree via `sr-only`, so the collapse is visual only:
 * a screen reader hears the same rail at every width, and the accessible name still carries the
 * `paused` suffix because that suffix is inside the label rather than bolted on with `aria-label`.
 */
export const ServiceRail = ({ services }: { services: Service[] }) => {
  const [selected, setSelected] = useSelectedService();
  const pathname = usePathname();
  /*
   * The scope travels with the view.
   *
   * Every piece of state the app has — which service, which range, which filters, which trace — is
   * in the query string, so a bare `href="/logs"` throws all of it away. It never showed while
   * `logs` was the only view: the link went to the page you were already on. With the service view
   * beside it (IKN-13) the same link is how you move between them, and dropping the selection means
   * arriving at the logs of every service, on the default range, having asked for neither.
   */
  const search = useSearchParams().toString();
  const withScope = (href: string) => (search ? `${href}?${search}` : href);

  /*
   * The issues badge, **scoped to the rail's own selection** (IKN-14).
   *
   * The rail says its selection re-scopes every view, so a badge that stayed fleet-wide while
   * everything beside it narrowed would be the one number on screen answering a different
   * question. With `all` selected it is the fleet count, which is the same rule.
   *
   * The same route the filter segments read, so the number beside the view name and the number
   * beside the segment label cannot come to disagree.
   */
  const issues = useIssueCounts(selected);
  /*
   * Fleet-wide, unlike the issues badge beside it — and deliberately.
   *
   * It is the same number the status bar prints, served by one poll for the whole chassis
   * (IKN-15 §4). A counter in permanent chrome that quietly narrowed when someone picked a service
   * would be the one number on screen answering a different question from the rest of the bar.
   */
  const { total: firing } = useAlertCounts();

  return (
    <nav
      aria-label={CHASSIS_TEXT.railLabel}
      className="ik-scroll flex w-[188px] flex-none flex-col gap-4 overflow-y-auto border-r border-chassis-border bg-chassis-surface px-2 py-3 max-rail:w-[52px] max-rail:px-1"
    >
      <section>
        <RailHeading>{CHASSIS_TEXT.services}</RailHeading>
        <ul className="flex flex-col">
          <li>
            <RailRow
              selected={selected === null}
              onClick={() => setSelected(null)}
              monogram={CHASSIS_TEXT.allServicesShort}
            >
              {CHASSIS_TEXT.allServices}
            </RailRow>
          </li>
          {services.map((service) => (
            <li key={service.name}>
              <RailRow
                selected={selected === service.name}
                onClick={() => setSelected(service.name)}
                muted={!service.enabled}
                monogram={monogram(service.name)}
                dot={service.health ? HEALTH_TONE[service.health.status] : null}
                trailing={
                  <Sparkline
                    values={service.sparkline}
                    tone="neutral"
                    surface="chassis"
                    width={40}
                    height={12}
                    label={CHASSIS_TEXT.sparklineLabel(service.name)}
                  />
                }
                title={railTitle(service)}
              >
                {service.name}
                {service.health && (
                  <span className="sr-only">
                    {" — "}
                    {CHASSIS_TEXT.healthWord[service.health.status] ?? service.health.status}
                  </span>
                )}
                {!service.enabled && (
                  <span className="ml-1.5 text-kicker text-chassis-text-dim">{CHASSIS_TEXT.paused}</span>
                )}
              </RailRow>
            </li>
          ))}
          {services.length === 0 && (
            /*
             * A sentence has no monogram. Collapsed, the rail says nothing rather than saying it
             * badly — the empty registry is still announced by the same element to a reader, and a
             * sighted user at 52px reads it the moment the window is wide enough to hold it.
             */
            <li className="px-2 py-1.5 text-micro leading-relaxed text-chassis-text-dim max-rail:sr-only">
              {CHASSIS_TEXT.noServices}
            </li>
          )}
        </ul>
      </section>

      {/* Collapsed, the headings are gone, so the groups need the rule the words were providing. */}
      <section className="max-rail:border-t max-rail:border-chassis-border max-rail:pt-2">
        <RailHeading>{CHASSIS_TEXT.views}</RailHeading>
        <ul className="flex flex-col">
          {VIEWS.map((view) => (
            <li key={view.key}>
              <Link
                href={withScope(view.href)}
                aria-current={pathname.startsWith(view.href) ? "page" : undefined}
                className={`flex items-center justify-between rounded-chip px-2 py-1.5 text-label transition-colors duration-150 ease-out max-rail:justify-center max-rail:px-0 ${
                  pathname.startsWith(view.href)
                    ? "bg-chassis-raised text-chassis-text-bright"
                    : "text-chassis-text-muted hover:bg-chassis-raised/60 hover:text-chassis-text"
                }`}
              >
                <span className="max-rail:sr-only">{view.label}</span>
                {/*
                 * Expanded, the badge is a dim shortcut hint beside the name — or, for `issues`, a
                 * count in a chip, which is the mockup's own distinction between a hint and a
                 * measurement. `text-chassis-text-dim` is 3.03 against the surface: a fine whisper
                 * next to a label, and not something to navigate by.
                 *
                 * Nothing at all while the count is unknown, rather than a `0` that would be a
                 * claim — see `IngestCard`'s "no reading yet".
                 */}
                {view.badge === "issues" ? (
                  issues.data !== null && (
                    <span className="rounded-chip bg-chassis-raised px-1.25 text-kicker tabular-nums text-chassis-text-muted max-rail:hidden">
                      {issues.data.unresolved}
                    </span>
                  )
                ) : view.badge === "alerts" ? (
                  /* Nothing at zero, not a red `0`. This badge exists to say there *is* something;
                     drawn at zero it would be a permanent warning that never means anything, which
                     is how a warning stops being read. */
                  firing !== null &&
                  firing > 0 && (
                    <span
                      className={`rounded-chip bg-chassis-raised px-1.25 text-kicker tabular-nums max-rail:hidden ${TONE_TEXT.chassis.error}`}
                    >
                      {firing}
                    </span>
                  )
                ) : (
                  <span className="text-kicker tracking-kicker text-chassis-text-dim max-rail:hidden">
                    {view.short}
                  </span>
                )}
                {/* Collapsed, the badge *is* the row, so it takes the row's own size and colour.
                    A count would be unreadable as an identity at 52px — `IS` says which row it is,
                    which is what the collapsed rail is for. */}
                <span
                  aria-hidden="true"
                  className="hidden text-label max-rail:block"
                >
                  {view.short}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* `mt-auto` here rather than on the user menu: the mockup puts the ingest card and the user
          together at the foot of the rail, and the gap has to open above both of them. */}
      <div className="mt-auto flex flex-col gap-2">
        <IngestCard />
        <UserMenu />
      </div>
    </nav>
  );
};

/**
 * The hover title: pm2 name (or the paused hint), then the last probe when one exists — the
 * words behind the dot, for whoever wants the number rather than the colour.
 */
const railTitle = (service: Service): string => {
  const base = service.enabled ? service.pm2Name : `${service.name} · ${CHASSIS_TEXT.pausedHint}`;
  if (!service.health) return base;

  const word = CHASSIS_TEXT.healthWord[service.health.status] ?? service.health.status;
  const latency = service.health.latencyMs === null ? "" : ` · ${service.health.latencyMs}ms`;
  return `${base} · ${CHASSIS_TEXT.healthHint(word, latency)}`;
};

const RailHeading = ({ children }: { children: React.ReactNode }) => (
  <h2 className="px-2 pb-1 text-kicker tracking-kicker text-chassis-text-dim uppercase max-rail:sr-only">{children}</h2>
);

const RailRow = ({
  children,
  selected,
  muted,
  title,
  monogram: collapsed,
  dot,
  trailing,
  onClick,
}: {
  children: React.ReactNode;
  selected: boolean;
  muted?: boolean;
  title?: string;
  monogram: string;
  /** Health tone for the leading dot; null draws nothing — a dot must be earned (IKN-8). */
  dot?: Tone | null;
  /** Right-aligned extra — the sparkline. Hidden collapsed, like the name it annotates. */
  trailing?: React.ReactNode;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    aria-pressed={selected}
    className={`flex w-full items-center rounded-chip px-2 py-1.5 text-left text-label transition-colors duration-150 ease-out max-rail:justify-center max-rail:px-0 ${
      selected
        ? "bg-chassis-raised text-chassis-text-bright"
        : "text-chassis-text-muted hover:bg-chassis-raised/60 hover:text-chassis-text"
    } ${muted ? "opacity-60" : ""}`}
  >
    {dot != null && (
      <span
        aria-hidden="true"
        className={`mr-1.5 inline-block size-1.5 flex-none rounded-full ${TONE_FILL.chassis[dot]} max-rail:hidden`}
      />
    )}
    <span className="min-w-0 flex-1 truncate max-rail:sr-only">{children}</span>
    {trailing != null && <span className="ml-1.5 flex-none max-rail:hidden">{trailing}</span>}
    <span
      aria-hidden="true"
      className="hidden max-rail:block"
    >
      {collapsed}
    </span>
  </button>
);

/**
 * The user menu, reduced to the entry that works.
 *
 * The mockup also carries "settings", which the design doc says should raise a "not in v1 scope"
 * toast — that needs the toast primitive, so it arrives with it rather than as a dead row here.
 */
const UserMenu = () => {
  const logout = useLogout();
  const [leaving, setLeaving] = useState(false);

  // Shared with `⌘⇧L` since IKN-22 — one path out, so the button and the shortcut cannot come to
  // disagree about what signing out does.
  const leave = async () => {
    setLeaving(true);
    await logout();
  };

  return (
    <section>
      <button
        type="button"
        onClick={leave}
        disabled={leaving}
        className="flex w-full items-center rounded-chip px-2 py-1.5 text-label text-chassis-text-muted transition-[color,background-color,opacity] duration-150 ease-out hover:bg-chassis-raised/60 hover:text-chassis-text disabled:opacity-50 max-rail:justify-center max-rail:px-0"
      >
        <span className="max-rail:sr-only">
          {leaving ? <Pending>{CHASSIS_TEXT.loggingOut}</Pending> : CHASSIS_TEXT.logOut}
        </span>
        <span
          aria-hidden="true"
          className="hidden max-rail:block"
        >
          {/* The mark alone, counting, in the 52px rail — this was a lone `…`, the worst case in
              the app: one cell of marks with no word beside it to be read against (IKN-57). */}
          {leaving ? <Pending /> : CHASSIS_TEXT.logOutShort}
        </span>
      </button>
    </section>
  );
};
