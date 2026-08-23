"use client";

import { LogPanel } from "@components/logs/LogPanel";
import { useSelectedService, useTimeRange } from "@lib/chassisState";
import { useServiceRuntime, useServiceSignals } from "@lib/useServiceView";
import { SERVICE_TEXT } from "@text/service";
import { ServiceHeader } from "./ServiceHeader";
import { Signals } from "./Signals";

import type { Service } from "@lib/services";

/**
 * The service view — IKN-13, design doc §5.2.
 *
 * Three rows: the header, the four signal tiles, and the log panel filling whatever is left. The
 * mockup draws a 296px rail of alerts and issues beside that panel; those are M3 (IKN-14, IKN-15)
 * and the tables do not exist, so per §4 the rail is **absent rather than faked** and the panel
 * takes the width.
 *
 * **The panel is the same component the `/logs` route mounts**, with no size of its own and no
 * prop saying which box it is in — that is IKN-12 §6's "one component, two sizes", and it is why
 * this file composes rather than rebuilding. It reads the same `service` parameter out of the URL
 * that the rail writes, so scoping is automatic: nothing here tells it what to show.
 *
 * The height chain is the whole layout. `ChassisFrame` is `h-dvh overflow-hidden`, the row below it
 * is `min-h-0 flex-1`, and this column is `h-full min-h-0` with two pinned rows and one that grows
 * — so at 1440×900 the page does not scroll and only the log list inside the panel does, which is
 * §U6 and the Done list's last line.
 */
export const ServiceView = ({ services }: { services: Service[] }) => {
  const [selected] = useSelectedService();
  const [range] = useTimeRange();

  const runtime = useServiceRuntime(selected);
  const signals = useServiceSignals(selected, range);

  return (
    /*
     * `bg-work-ground` rather than the `bg-work-surface` `<main>` paints.
     *
     * This is the first screen that is entirely cards, and a card whose fill is the same value as
     * the ground it sits on has only its hairline border left to be a card with. §3.1 reserves
     * elevation for what overhangs, so the separation has to come from the ground — which is what
     * the mockup's own darker work area was doing.
     */
    <div className="flex h-full min-h-0 flex-col gap-2.75 bg-work-ground px-3 py-2.75">
      {selected === null ? (
        <Notice>{SERVICE_TEXT.noService}</Notice>
      ) : runtime.data !== null ? (
        /*
         * A reading in hand beats a failed poll, and it is checked first for that reason.
         *
         * The runtime re-reads every fifteen seconds. Preferring the error would let one dropped
         * request — a laptop waking up, a restart of the API — replace a populated header with an
         * apology, and then restore it a quarter of a minute later. The reading it is showing is
         * the last one that arrived, which is what a header of process facts is anyway.
         */
        <ServiceHeader
          runtime={runtime.data}
          range={range}
        />
      ) : runtime.error !== null ? (
        <Notice>
          {runtime.error}{" "}
          <button
            type="button"
            onClick={runtime.reload}
            className="underline underline-offset-2 hover:text-work-text"
          >
            {SERVICE_TEXT.retry}
          </button>
        </Notice>
      ) : (
        /* The header's own shape, empty. Holding the box is what keeps the tiles and the panel from
           jumping a row the moment the first answer lands. */
        <Notice>{SERVICE_TEXT.loading}</Notice>
      )}

      {selected !== null && (
        <Signals
          service={selected}
          signals={signals.data}
          runtime={runtime.data?.runtime ?? null}
          range={range}
          loading={signals.loading}
          runtimeLoading={runtime.loading}
          error={signals.data === null ? signals.error : null}
        />
      )}

      {/* `min-h-0` is what lets this shrink below its content and hand the overflow to the list
          inside the panel, instead of pushing the status bar off the bottom of the screen. */}
      <div className="min-h-0 flex-1">
        <LogPanel services={services} />
      </div>
    </div>
  );
};

/** A header-shaped box carrying one sentence — same height, so nothing below it moves. */
const Notice = ({ children }: { children: React.ReactNode }) => (
  <section className="flex h-[52px] flex-none items-center rounded-card border border-work-border bg-work-surface px-3.25 text-row text-work-text-muted">
    <p>{children}</p>
  </section>
);
