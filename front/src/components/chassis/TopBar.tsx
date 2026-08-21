"use client";

import { useSelectedService, useTimeRange } from "@lib/chassisState";
import { RANGE_KEYS } from "@lib/timeRange";
import { timeLabel } from "@lib/zone";
import { useZone } from "@lib/zoneState";
import { CHASSIS_TEXT } from "@text/chassis";
import { useEffect, useState } from "react";
import { ZoneToggle } from "./ZoneToggle";

/**
 * The top bar — brand, host badge, breadcrumb, the global time range.
 *
 * Three things the mockup draws here are **absent, not stubbed**: the ⌘K trigger belongs to
 * IKN-22, and collector lag to IKN-24. A control that is visible and dead is the "grisée à venir"
 * the design doc rules out in as many words, so they arrive with the tickets that can answer them.
 */
export const TopBar = () => {
  const [service] = useSelectedService();
  const [range, setRange] = useTimeRange();

  return (
    <header className="flex h-9 flex-none items-center gap-3.5 border-b border-chassis-border bg-chassis-surface px-3.5">
      <span className="text-ui font-bold tracking-chrome text-chassis-text">IKNOS</span>

      <span className="rounded-chip border border-chassis-border-strong px-1.5 py-0.5 text-kicker tracking-kicker text-chassis-text-muted">
        {CHASSIS_TEXT.host}
      </span>

      <nav
        aria-label={CHASSIS_TEXT.breadcrumbLabel}
        className="flex items-center gap-1.5 text-label"
      >
        <span className="text-chassis-text-dim">{CHASSIS_TEXT.services}</span>
        <span className="text-chassis-text-dim">/</span>
        <span className="text-chassis-text">{service ?? CHASSIS_TEXT.allServices}</span>
      </nav>

      <div className="ml-auto flex items-center gap-3.5">
        {/* A fieldset rather than a div with role="group": same semantics, and the native element
            is what assistive tech already understands without being told. */}
        <fieldset
          className="flex items-center gap-0.5"
          aria-label={CHASSIS_TEXT.rangeLabel}
        >
          {RANGE_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setRange(key)}
              aria-pressed={range === key}
              className={
                range === key
                  ? "rounded-chip bg-chassis-raised px-1.5 py-0.5 text-kicker tracking-control text-chassis-text-bright"
                  : "rounded-chip px-1.5 py-0.5 text-kicker tracking-control text-chassis-text-dim hover:text-chassis-text"
              }
            >
              {key}
            </button>
          ))}
        </fieldset>
        <Clock />
        <ZoneToggle />
      </div>
    </header>
  );
};

/**
 * Rendered empty until mounted.
 *
 * The server and the browser do not agree on what time it is — they are separated by the flight
 * time of the page — and React treats that disagreement as a hydration error. An empty slot for
 * one frame is the cost of not having the console log a mismatch on every single page load.
 *
 * Since IKN-38 it reads the same zone as the panel below it, through the same formatter. This
 * clock used to be the app's one local-time render, and the log header said `utc` out loud
 * precisely to warn that the two disagreed; there is nothing left to warn about. `timeLabel` at a
 * one-second bucket is `HH:MM:SS` — the shape `w-[62px]` is cut for, and no zone suffix is
 * appended here because the toggle sitting beside it already names the zone.
 */
const Clock = () => {
  const { tz } = useZone();
  const [now, setNow] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setNow(timeLabel(Date.now(), 1_000, tz));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [tz]);

  return (
    <span
      className="w-[62px] text-right text-row tabular-nums text-chassis-text-muted"
      suppressHydrationWarning
    >
      {now ?? ""}
    </span>
  );
};
