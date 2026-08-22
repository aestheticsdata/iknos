"use client";

import { cn } from "@lib/utils";
import { useZone } from "@lib/zoneState";
import { CHASSIS_TEXT } from "@text/chassis";

import type { Zone } from "@lib/zone";

/**
 * The two halves, left to right.
 *
 * UTC first because it is the fixed point: it is what the API emits, what the cursor counts in and
 * what the address bar carries, and it is the same three letters in January and in August. The
 * reader's own clock is the half that changes name twice a year, so it goes second — the column
 * that moves sits beside the clock it belongs to, which is the next thing along in the bar.
 */
const HALVES: readonly Zone[] = ["utc", "local"];

/**
 * Which clock the panel is read on — IKN-38, redrawn as a segmented control in IKN-48.
 *
 * Last in the bar, to the right of the chassis clock, because the zone governs both: that clock
 * was the app's only local-time render and the reason the log header had to say `utc` out loud.
 * One control for one decision, at the end of the row it changes.
 *
 * **Both halves are painted at all times and only the lit one moves.** What shipped first was a
 * single button showing the zone in force and rewriting itself on every press, and three letters
 * in a thin box do not read as a control with two states — the base layer's `cursor: pointer` rule
 * exists because this exact button sat through a whole session without being recognised as one.
 * Naming both zones and lighting one says *there is another clock, and you are not on it* without
 * anything having to be inferred from a label that changes.
 *
 * The shape is Halcyon's `toggle` — a sunken track, two labels, one block that travels between
 * them, and the accent riding on the lit one — in Iknos's ramp. What is not carried over is
 * `role="switch"`: a switch has an on and an off, and this has two peers.
 *
 * **The accent is the brand ink, not the healthy one, and the difference decides how it is used
 * here.** `chassis-accent` also paints a collector that is up, so a control wearing it on one side
 * of a pair could be read as *this clock is the well one*. What stops that reading is that the
 * block is never absent: it is on one half or the other at all times, and it is the same green in
 * both places. Green on a dot means a state was measured; green here means an option was chosen,
 * and it is the same pairing — `bg-chassis-accent` under `text-chassis-deep` — that `Button`'s
 * solid variant already uses for the one thing a screen is for.
 *
 * So: two real buttons in a `fieldset`, which is the idiom the range buttons three items to the
 * left already use, with `aria-pressed` for the state. Each half is named by its own visible text
 * — the fabricated `CEST · switch to UTC` is gone, and with it the label-in-name problem it was
 * written to work around: the accessible name is now the label, and the group's name says what the
 * pair of them is for.
 *
 * **Nothing here may move anything.** The cluster is `ml-auto`, packed against the right edge, so
 * every item in it sits at the mercy of the widths beside it and any change of size drags the
 * range buttons and the clock sideways. Two separate ways that could happen, both closed below:
 * the box changing width when pressed, and the control appearing at mount.
 */
export const ZoneToggle = () => {
  const { zone, abbrevs, setZone } = useZone();

  /*
   * The zone is unknowable on the server — `localStorage` does not exist there and the runtime
   * resolves to `Etc/UTC` — so the first paint cannot name it, and cannot say which half is lit
   * either. Rendered *invisible* rather than absent, which is the same trade the clock beside it
   * has always made: the box holds its place, so the bar does not jump when the effect lands one
   * frame later.
   *
   * Inert while it waits, and `disabled` goes on the `<fieldset>` rather than on each button: the
   * native element already disables everything inside it, which is one attribute where the old
   * single button needed three. A disabled control is not focusable, so there is no focus ring
   * landing on an invisible box and no tab stop to explain.
   */
  const known = zone !== null && abbrevs !== null;

  /*
   * **The `key` is what keeps the mount from looking like a press**, and it is the one line here
   * that is not obvious from what it does.
   *
   * Mounting flips everything at once: the box becomes visible, the labels arrive, and the block
   * lands on whichever half `localStorage` named. Every one of those is a *changed value* on an
   * element that was already in the document, which is precisely what starts a CSS transition — so
   * without this the panel opens by sliding the block across and fading a label, reporting a
   * decision nobody made. (Measured, not assumed: a `CSSTransition(translate)` ran 148ms after
   * load, before anything was clicked.)
   *
   * Gating the transition classes on `known` does not help, because the after-change style is what
   * the browser reads: adding the class in the same commit as the move still transitions. What
   * does help is that a transition needs a *before*, and a freshly inserted element has none. So
   * the subtree is rebuilt on the one commit where the zone stops being unknown, and the browser
   * has nothing to interpolate from. Every commit after it is a real press, and travels.
   */

  return (
    <fieldset
      key={known ? "zone" : "pending"}
      aria-hidden={!known || undefined}
      aria-label={CHASSIS_TEXT.zoneLabel}
      disabled={!known}
      className={cn(
        /*
         * `grid-cols-2` is what keeps the press from moving the bar, and it is doing more work
         * than it looks: two `1fr` columns in a box that sizes to its content come out *equal*,
         * both as wide as the wider of the two labels. So the box measures the same whichever
         * zone is in force — there is nothing left that a press could change — and the block below
         * can be a flat 50% rather than something that has to measure a string.
         */
        "relative grid h-6 grid-cols-2 select-none overflow-hidden rounded-control",
        "border border-chassis-border-strong bg-chassis-inset",
        !known && "invisible",
      )}
    >
      {/*
       * The lit side is one block that travels, not two halves that repaint. A repaint has nothing
       * to interpolate — the colour would leave one side and arrive on the other in the same
       * frame, which reads as a blink rather than as a switch.
       *
       * This is the fifth moving thing in Iknos and the rule in `animations.css` is why it is only
       * the fifth: it is one half of a box 24px tall, it is inside the control the reader just
       * pressed, and it reports that press and nothing else. It is a `transition` rather than one
       * of the four `--animate-*` gestures, which also means the global `prefers-reduced-motion`
       * rule already collapses it — the block arrives on the other half without crossing the gap,
       * and the colours are correct either way.
       *
       * `overflow-hidden` on the track above is what rounds its outer corners against the border
       * and leaves the inner ones square, and `translate-x-0` is written out rather than left off
       * so both ends of the travel are a transform.
       */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-0 left-0 w-1/2 bg-chassis-accent",
          "transition-transform duration-150 ease-out",
          zone === "local" ? "translate-x-full" : "translate-x-0",
        )}
      />

      {HALVES.map((half) => (
        <button
          key={half}
          type="button"
          onClick={() => setZone(half)}
          aria-pressed={known ? zone === half : undefined}
          title={CHASSIS_TEXT.zoneHint}
          className={cn(
            /*
             * `relative` puts the labels above the block: both are positioned at `z-index: auto`,
             * and the block is the earlier one in the DOM. No `z-10` is needed and none is used —
             * a stacking context here would be a thing to reason about later for no gain.
             *
             * The outline is pulled *inside* the button. `overflow-hidden` on the track clips a
             * descendant's outline along with everything else, so the base layer's 2px accent ring
             * at `+2` offset would be shaved to nothing on the two outer edges — a focus ring that
             * is invisible exactly where a keyboard is the only way in. At `-2` it is drawn just
             * within the half's own edge and says which half has focus.
             *
             * And on the lit half it changes colour, which is the second thing the accent costs
             * here: the base ring *is* `chassis-accent`, so on a half the accent has just filled
             * it is green on green and there is no ring at all. `chassis-deep` is the ink already
             * carrying the label on that ground, and it reads there at 8.22:1.
             */
            "relative flex min-w-[5ch] items-center justify-center px-1.5",
            "text-kicker tracking-control focus-visible:-outline-offset-2",
            /*
             * The block says which zone is in force and the ink says it a second time: the
             * covered label drops to the chassis's own dark so the accent can carry it, the
             * uncovered one sits back at `text-muted` and comes forward under the pointer. 8.22:1
             * on the block and 7.50:1 on the track — both measured, both clear of AA at 9px, which
             * `text-dim` (3.81:1 here) would not be.
             *
             * Faster than the block on purpose: `ease-out` front-loads the travel, so matching the
             * ink to the block's *perceived* arrival is what stops the bright label from sitting
             * on the bare track mid-flight.
             */
            "transition-colors duration-100 ease-out",
            zone === half
              ? "text-chassis-deep focus-visible:outline-chassis-deep"
              : "text-chassis-text-muted hover:text-chassis-text",
          )}
        >
          {/*
           * Empty until the zone is known — see above, and the reason the box needs a floor at all.
           *
           * The measuring is still done by the two real strings: the columns size to them, and
           * they are what a zone abbreviated `GMT+10` widens. `5ch` only holds the box open across
           * the frame before either string exists, and it is deliberately loose — `ch` counts the
           * font's advance and not `tracking-control`'s letter-spacing on top of it, so it is a
           * floor rather than a measurement. Wide enough for every lettered abbreviation there is;
           * a numeric one costs a character per half at mount, which is the same trade the single
           * button made and the last one left.
           */}
          {abbrevs?.[half] ?? ""}
        </button>
      ))}
    </fieldset>
  );
};
