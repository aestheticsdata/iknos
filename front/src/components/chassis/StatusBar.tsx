"use client";

import { useSelectedService, useTimeRange } from "@lib/chassisState";
import { CHASSIS_TEXT } from "@text/chassis";

/**
 * The status bar.
 *
 * The mockup's row reads `NORMAL │ pfa │ tail on │ 10 464 ev / 1h │ q 38ms │ 1 alert │ keys`.
 * Four of those cells describe things that do not exist yet — tail state and event count come with
 * the log panel (IKN-12), query time with it, the alert count with IKN-15 — so the bar ships with
 * the cells it can fill honestly and grows the rest as their data arrives. An `ev/1h` that always
 * says zero is worse than a bar that does not claim to know.
 */
export const StatusBar = () => {
  const [service] = useSelectedService();
  const [range] = useTimeRange();

  return (
    <footer className="flex h-6 flex-none items-center gap-3 border-t border-chassis-border bg-chassis-surface px-3.5 text-kicker tracking-control text-chassis-text-dim">
      <span className="text-chassis-text-muted">{CHASSIS_TEXT.modeNormal}</span>
      <Divider />
      <span>{service ?? CHASSIS_TEXT.allServices}</span>
      <Divider />
      <span>{range}</span>

      <span className="ml-auto hidden text-chassis-text-dim rail:inline">{CHASSIS_TEXT.keyLegend}</span>
    </footer>
  );
};

const Divider = () => (
  <span
    aria-hidden
    className="text-chassis-border-strong"
  >
    │
  </span>
);
