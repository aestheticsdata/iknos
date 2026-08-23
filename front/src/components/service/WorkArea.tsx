"use client";

import { LogPanel } from "@components/logs/LogPanel";
import { useSelectedService, useSignalsOpen, useTimeRange } from "@lib/chassisState";
import { useServiceRuntime, useServiceSignals } from "@lib/useServiceView";
import { SERVICE_TEXT } from "@text/service";
import { ServiceHeader, SignalsToggle } from "./ServiceHeader";
import { Signals } from "./Signals";

import type { Service } from "@lib/services";

/**
 * The work area — one screen, two shapes, decided by the rail (IKN-13).
 *
 * There were two routes for a fortnight: `/logs` was the log explorer and `/service` was the same
 * panel with a header and four tiles bolted above it. Nobody could say what the second one was
 * *for* — it contained the first — and having to navigate between two screens that shared most of
 * their pixels was the wrong answer to a question nobody had asked. They are one route now, and
 * the rail's selection is what decides which shape it takes:
 *
 * - **`all`** — the log explorer, edge to edge, byte for byte what `/logs` has always been. There
 *   is no header, because there is no one service to head it with, and no tiles, because a
 *   throughput summed across nineteen services answers nothing.
 * - **one service** — the same panel, on the work ground, under a header and the signal tiles.
 *
 * The padding arrives with the selection rather than being there always, and deliberately: full
 * bleed is worth a row and a half of log lines to a reader who is only reading logs, and the
 * moment it changes is a moment the whole screen changes anyway.
 *
 * **The tiles collapse.** They are two thirds of the height above the panel, and the reader who
 * wants the header's health pills and nothing else should not have to give that up — `⌘L` and the
 * button in the header both toggle it, and the answer is in the URL so it survives a reload and
 * travels in a link.
 *
 * The height chain is unchanged: `ChassisFrame` is `h-dvh overflow-hidden`, the row below it is
 * `min-h-0 flex-1`, and this column is `h-full min-h-0` with pinned rows and one that grows — so
 * at 1440×900 the page does not scroll and only the log list inside the panel does.
 */
export const WorkArea = ({ services }: { services: Service[] }) => {
  const [selected] = useSelectedService();
  const [range] = useTimeRange();
  const [signalsOpen, toggleSignals] = useSignalsOpen();

  const runtime = useServiceRuntime(selected);
  /*
   * Not fetched while the tiles are hidden.
   *
   * These are three aggregates over a partition-pruned range, and the runtime poll beside them is
   * enough to keep the header current. A collapsed tile row that went on grouping a week of
   * samples every thirty seconds would be paying the whole cost of the thing that was hidden to
   * save it.
   */
  const signals = useServiceSignals(signalsOpen ? selected : null, range);

  // The log explorer, unwrapped and unpadded — no ground, no header, no tiles. Every hook above
  // has already run, so the early return costs nothing and changes nothing about their order.
  if (selected === null) return <LogPanel services={services} />;

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
      {runtime.data !== null ? (
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
          signalsOpen={signalsOpen}
          onToggleSignals={toggleSignals}
        />
      ) : runtime.error !== null ? (
        <Notice
          signalsOpen={signalsOpen}
          onToggleSignals={toggleSignals}
        >
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
        <Notice
          signalsOpen={signalsOpen}
          onToggleSignals={toggleSignals}
        >
          {SERVICE_TEXT.loading}
        </Notice>
      )}

      {signalsOpen && (
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

/** A header-shaped box carrying one sentence — same height, and the same toggle, so nothing moves. */
const Notice = ({
  children,
  signalsOpen,
  onToggleSignals,
}: {
  children: React.ReactNode;
  signalsOpen: boolean;
  onToggleSignals: () => void;
}) => (
  <section className="flex h-[52px] flex-none items-center gap-3 rounded-card border border-work-border bg-work-surface px-3.25 text-row text-work-text-muted">
    <p className="min-w-0 flex-1">{children}</p>
    <SignalsToggle
      open={signalsOpen}
      onToggle={onToggleSignals}
    />
  </section>
);
