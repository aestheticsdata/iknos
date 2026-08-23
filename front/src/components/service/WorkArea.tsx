"use client";

import { LogPanel } from "@components/logs/LogPanel";
import { Pending } from "@components/ui/Pending";
import { useSelectedService, useSignalsOpen, useTimeRange } from "@lib/chassisState";
import { useServiceRuntime, useServiceSignals } from "@lib/useServiceView";
import { cn } from "@lib/utils";
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
  const signals = useServiceSignals(selected, range, signalsOpen);

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
    /*
     * No `gap` on this column, and the rows carry their own `mb-2.75` instead.
     *
     * A gap is not a property of anything, so it cannot be transitioned — a signals row folded to
     * zero height would still be sitting between two 11px gaps, and the panel would stop 11px lower
     * than it should with nothing on screen to explain the space. Owned by the rows, the spacing
     * collapses with the row that owns it, in the same 150ms.
     */
    <div className="flex h-full min-h-0 flex-col bg-work-ground px-3 py-2.75">
      {runtime.data !== null ? (
        /*
         * A reading in hand beats a failed poll, and it is checked first for that reason.
         *
         * The runtime re-reads every fifteen seconds. Preferring the error would let one dropped
         * request — a laptop waking up, a restart of the API — replace a populated header with an
         * apology, and then restore it a quarter of a minute later. The reading it is showing is
         * the last one that arrived, which is what a header of process facts is anyway.
         */
        <div className="mb-2.75 flex-none">
          <ServiceHeader
            runtime={runtime.data}
            range={range}
            signalsOpen={signalsOpen}
            onToggleSignals={toggleSignals}
          />
        </div>
      ) : runtime.error !== null ? (
        <Notice
          signalsOpen={signalsOpen}
          onToggleSignals={toggleSignals}
        >
          {runtime.error}{" "}
          <button
            type="button"
            onClick={runtime.reload}
            className="underline underline-offset-2 transition-colors duration-150 ease-out hover:text-work-text"
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
          {/* The same 52px box as the failure branch above, and now it is the mark rather than
              the `retry` button that tells them apart — a waiting header and a failed one used
              to differ by one word and one link (IKN-57). */}
          <Pending>{SERVICE_TEXT.loading}</Pending>
        </Notice>
      )}

      {/*
       * The fold, and why it is a grid rather than a height.
       *
       * `height` cannot be transitioned from a number to `auto`, and the row's height is not a
       * constant anybody should be writing down — it is four tiles, or one sentence for a service
       * nobody scrapes. A single grid row going `1fr → 0fr` animates
       * to whatever the content happens to be, with the child clipped inside it, and needs no
       * measurement at all.
       *
       * `min-h-0` twice: once so the flex item may shrink under its own content, and once so the
       * grid item may. Without either the row refuses to go below its content and nothing moves.
       *
       * The tiles stay mounted while it is shut. They cost nothing — the fetch is what was
       * expensive and that is gated in `useServiceSignals` — and an unmounted row has no
       * before-value to open from, which is the whole reason this is a fold and not a pop.
       */}
      <div
        className={cn(
          "grid min-h-0 transition-[grid-template-rows,margin-bottom,opacity] duration-150 ease-out",
          signalsOpen ? "mb-2.75 grid-rows-[1fr] opacity-100" : "mb-0 grid-rows-[0fr] opacity-0",
        )}
        // `inert` rather than `hidden`: it keeps the box the transition is animating while taking
        // the whole row out of the tab order and off the accessibility tree, which a folded-away
        // row has no business being in.
        inert={!signalsOpen}
      >
        <div className="min-h-0 overflow-hidden">
          <Signals
            service={selected}
            signals={signals.data}
            runtime={runtime.data?.runtime ?? null}
            range={range}
            loading={signals.loading}
            runtimeLoading={runtime.loading}
            error={signals.data === null ? signals.error : null}
          />
        </div>
      </div>

      {/* `min-h-0` is what lets this shrink below its content and hand the overflow to the list
          inside the panel, instead of pushing the status bar off the bottom of the screen.

          The card shape is decided here, not by `LogPanel` (IKN-56): the panel is also mounted
          edge to edge in the all-services explorer above and has no way to know which box it is
          in, so rounding it there would round the wrong route too. `chassis-border`, not
          `work-border` — the panel is a dark window on this page's ground, the pairing
          `IngestCard` uses rather than the one its `Notice`/`ServiceHeader` siblings do. */}
      <div className="min-h-0 flex-1 overflow-hidden rounded-card border border-chassis-border">
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
  <section className="mb-2.75 flex h-[52px] flex-none items-center gap-3 rounded-card border border-work-border bg-work-surface px-3.25 text-row text-work-text-muted">
    <p className="min-w-0 flex-1">{children}</p>
    <SignalsToggle
      open={signalsOpen}
      onToggle={onToggleSignals}
    />
  </section>
);
