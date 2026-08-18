"use client";

import { useSelectedService } from "@lib/chassisState";
import { postWithCsrf } from "@lib/csrf";
import { ROUTES } from "@lib/routes";
import { CHASSIS_TEXT } from "@text/chassis";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import type { Service } from "@lib/services";

/** The one view M1 can fill. Metrics, issues and alerts join this list with their own tickets. */
const VIEWS = [{ key: "logs", label: CHASSIS_TEXT.viewLogs, href: ROUTES.logs, badge: "L" }] as const;

/**
 * The service rail — selection scopes every view.
 *
 * **No status dot and no sparkline.** Both are drawn in the mockup and both describe health, which
 * arrives with IKN-8; the contract leaves those fields out of the payload rather than sending
 * zeroes, and the rail omits them rather than drawing a flat line for a service nobody has probed.
 * `enabled` is the one fact that *is* known, and it says whether Iknos is collecting — which is
 * why a paused service is dimmed and labelled rather than given a grey dot that reads as "down".
 */
export const ServiceRail = ({ services }: { services: Service[] }) => {
  const [selected, setSelected] = useSelectedService();
  const pathname = usePathname();

  return (
    <nav
      aria-label={CHASSIS_TEXT.railLabel}
      className="flex w-[188px] flex-none flex-col gap-4 overflow-y-auto border-r border-chassis-border bg-chassis-surface px-2 py-3 max-rail:w-[52px]"
    >
      <section>
        <RailHeading>{CHASSIS_TEXT.services}</RailHeading>
        <ul className="flex flex-col">
          <li>
            <RailRow
              selected={selected === null}
              onClick={() => setSelected(null)}
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
                title={service.enabled ? service.pm2Name : CHASSIS_TEXT.pausedHint}
              >
                {service.name}
                {!service.enabled && (
                  <span className="ml-1.5 text-kicker text-chassis-text-dim">{CHASSIS_TEXT.paused}</span>
                )}
              </RailRow>
            </li>
          ))}
          {services.length === 0 && (
            <li className="px-2 py-1.5 text-micro leading-relaxed text-chassis-text-dim">{CHASSIS_TEXT.noServices}</li>
          )}
        </ul>
      </section>

      <section>
        <RailHeading>{CHASSIS_TEXT.views}</RailHeading>
        <ul className="flex flex-col">
          {VIEWS.map((view) => (
            <li key={view.key}>
              <Link
                href={view.href}
                aria-current={pathname.startsWith(view.href) ? "page" : undefined}
                className={`flex items-center justify-between rounded-xs px-2 py-1.5 text-label ${
                  pathname.startsWith(view.href)
                    ? "bg-chassis-raised text-chassis-text-bright"
                    : "text-chassis-text-muted hover:bg-chassis-raised/60 hover:text-chassis-text"
                }`}
              >
                <span>{view.label}</span>
                <span className="text-kicker tracking-kicker text-chassis-text-dim">{view.badge}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <UserMenu />
    </nav>
  );
};

const RailHeading = ({ children }: { children: React.ReactNode }) => (
  <h2 className="px-2 pb-1 text-kicker tracking-kicker text-chassis-text-dim uppercase">{children}</h2>
);

const RailRow = ({
  children,
  selected,
  muted,
  title,
  onClick,
}: {
  children: React.ReactNode;
  selected: boolean;
  muted?: boolean;
  title?: string;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    aria-pressed={selected}
    className={`flex w-full items-center rounded-xs px-2 py-1.5 text-left text-label ${
      selected
        ? "bg-chassis-raised text-chassis-text-bright"
        : "text-chassis-text-muted hover:bg-chassis-raised/60 hover:text-chassis-text"
    } ${muted ? "opacity-60" : ""}`}
  >
    {children}
  </button>
);

/**
 * The user menu, reduced to the entry that works.
 *
 * The mockup also carries "settings", which the design doc says should raise a "not in v1 scope"
 * toast — that needs the toast primitive, so it arrives with it rather than as a dead row here.
 */
const UserMenu = () => {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  const logout = async () => {
    setLeaving(true);
    try {
      // Authenticated, so it needs the CSRF header — unlike the four public auth routes.
      await postWithCsrf("/auth/logout");
    } finally {
      // Push regardless: a logout that failed server-side still must not leave the chassis up,
      // and the middleware bounces the next navigation anyway once the cookie is gone.
      router.push(ROUTES.login);
    }
  };

  return (
    <section className="mt-auto">
      <button
        type="button"
        onClick={logout}
        disabled={leaving}
        className="flex w-full items-center rounded-xs px-2 py-1.5 text-label text-chassis-text-muted hover:bg-chassis-raised/60 hover:text-chassis-text disabled:opacity-50"
      >
        {leaving ? CHASSIS_TEXT.loggingOut : CHASSIS_TEXT.logOut}
      </button>
    </section>
  );
};
