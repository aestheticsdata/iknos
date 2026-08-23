"use client";

import { useSelectedService, useTimeRange } from "@lib/chassisState";
import { RANGE_KEYS } from "@lib/timeRange";
import { cn } from "@lib/utils";
import { timeLabel } from "@lib/zone";
import { useZone } from "@lib/zoneState";
import { CHASSIS_TEXT } from "@text/chassis";
import { useEffect, useState } from "react";
import { CollectorPill } from "./CollectorPill";
import { ZoneToggle } from "./ZoneToggle";

/**
 * The top bar — brand, host badge, breadcrumb, the global time range.
 *
 * The ⌘K trigger the mockup draws here is still **absent, not stubbed** — it belongs to IKN-22. A
 * control that is visible and dead is the greyed-out coming-soon the design doc rules out in as
 * many words, so it arrives with the ticket that can answer it. Collector lag was in that list until
 * IKN-24 gave it something true to say.
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
        {/* Left of the range buttons and the clock: it describes the tool, not the query, and the
            two kinds of control should not be interleaved. Hidden on the narrow layout, where the
            range buttons and the clock have first claim on the width — the rail's ingest card
            still carries the collector's state there. */}
        <span className="hidden rail:flex">
          <CollectorPill />
        </span>
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
              className={cn(
                // On the shared base rather than in either branch: a transition present on only
                // one side of a swap animates in one direction and snaps back in the other.
                "rounded-chip px-1.5 py-0.5 text-kicker tracking-control transition-colors duration-150 ease-out",
                range === key
                  ? "bg-chassis-raised text-chassis-text-bright"
                  : "text-chassis-text-dim hover:text-chassis-text",
              )}
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
 *
 * It is also the timestamp closest to the toggle, so it is the one whose flash is read as the
 * button's own feedback — IKN-47.
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
    <span className="w-[62px] text-right text-row tabular-nums text-chassis-text-muted">
      {/* The flash sits on a child of the box that carries the ink, never on the box itself:
          `ik-zone-flash` mixes from `currentcolor`, and inside the `color` property that resolves
          to the *inherited* colour. Both on one element would be the class mixing with itself. */}
      <span
        className="ik-zone-flash ik-zone-lift"
        suppressHydrationWarning
      >
        {now ?? ""}
      </span>
    </span>
  );
};
