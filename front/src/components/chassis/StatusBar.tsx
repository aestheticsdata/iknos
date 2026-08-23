"use client";

import { useSelectedService, useTimeRange } from "@lib/chassisState";
import { useChromeMode } from "@lib/commandState";
import { formatCount } from "@lib/format";
import { cn } from "@lib/utils";
import { useViewStatus } from "@lib/viewStatus";
import { CHASSIS_TEXT } from "@text/chassis";

/**
 * The status bar — IKN-22 §3.
 *
 * The mockup's row reads `NORMAL │ pfa │ tail on │ 10 464 ev / 1h │ q 38ms │ 1 alert │ keys`, and
 * every cell but one is now fillable. The **active-alert count stays absent** until IKN-15: a
 * permanent `0 alerts` is not reassurance, it is a claim nobody has checked.
 *
 * The three that describe the view are published by it rather than hoisted up here (see
 * `viewStatus`), so they simply disappear on a page that has no log list — which is honest, and is
 * why they are `null`-able rather than defaulted.
 *
 * `q 38ms` is the cell that earns the bar its place. It is the server's own measurement around the
 * database call, so a query that has quietly become slow is visible without anyone having gone
 * looking for it — which on a tool whose whole subject is other people's latency is the least it
 * can do about its own.
 */
export const StatusBar = () => {
  const [service] = useSelectedService();
  const [range] = useTimeRange();
  const mode = useChromeMode();
  const { live, count, tookMs } = useViewStatus();

  return (
    <footer className="flex h-6 flex-none items-center gap-3 border-t border-chassis-border bg-chassis-surface px-3.5 text-kicker tracking-control text-chassis-text-dim">
      {/* The mode is what tells you why `j` just did nothing: a modal has the keyboard. */}
      <span className="text-chassis-text-muted">
        {mode === "MODAL" ? CHASSIS_TEXT.modeModal : CHASSIS_TEXT.modeNormal}
      </span>
      <Divider />
      <span>{service ?? CHASSIS_TEXT.allServices}</span>
      <Divider />
      <span>{range}</span>

      {live !== null && (
        <>
          <Divider />
          <span className={cn("transition-colors duration-150 ease-out", live && "text-chassis-accent")}>
            {live ? CHASSIS_TEXT.tailOn : CHASSIS_TEXT.tailOff}
          </span>
        </>
      )}

      {count !== null && (
        <>
          <Divider />
          <span className="tabular-nums">{CHASSIS_TEXT.events(formatCount(count), range)}</span>
        </>
      )}

      {tookMs !== null && (
        <>
          <Divider />
          <span className="tabular-nums">{CHASSIS_TEXT.queryTime(tookMs)}</span>
        </>
      )}

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
