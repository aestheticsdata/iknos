"use client";

import { useCursorHover } from "@components/ui/useCursorHover";
import { cn } from "@lib/utils";
import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { CursorPoint } from "@components/ui/useCursorHover";
import type { FocusEvent, KeyboardEvent, ReactNode } from "react";

/**
 * Iknos's only tooltip — ported from Zeus (ZEU-40/43/45), which took it from PFA (PFA-107).
 *
 * What it replaces is a CSS-only bubble positioned `bottom-full left-1/2` inside whatever contained
 * it. That shape had two limits this one does not: it could only ever hold a few words, and it was
 * clipped by the first ancestor with `overflow: hidden` — which in this product is every panel, so
 * the two places that most needed a hint (the histogram's axis row, the signal tiles' charts) were
 * the two places the old component could not be used. This one portals to `<body>`, follows the
 * pointer, and clamps itself inside the viewport, so where it can be used stops being a question
 * about the DOM around it.
 *
 * `mode` says **who owns the datum**, not where the bubble goes — both modes follow the pointer:
 *
 * - `mode="cursor"` — the caller resolves which mark the pointer is over and feeds a `point` from
 *   `useCursorHover`. Every chart, where the content is per-bar and only the chart knows which bar.
 * - `mode="hover"` — the wrapper tracks its own trigger, and is reachable by keyboard: a
 *   `focus-visible` arrival anchors the bubble to the trigger's box, blur and Escape close it.
 *
 * The discriminated union is load-bearing: `point` is required on one and meaningless on the other,
 * and one component with both optional is one nobody can call correctly.
 */

/**
 * The bubble's skin.
 *
 * **Always the chassis, whatever it is covering** — §3.1 puts everything that overhangs on the dark
 * ramp, and `chassis-raised` is one step up from the log panel it floats over while being a value
 * nothing on the work surface holds. That was the old component's rule too, and the one thing about
 * it worth keeping.
 *
 * ⚠️ The 90% is affordable *because of* the blur. Transparency alone lets whatever is underneath
 * keep its edges — over the log stream that means rows of text reading straight through the bubble
 * as a second column competing with the first. Blurred, the background stays present as colour and
 * shape while nothing behind it is legible enough to be mistaken for content.
 *
 * ⚠️ `whitespace-pre-line`. Several of these bubbles carry strings that were native `title`
 * attributes, where a `\n` is a line break; a `div` collapses it, and dropping this would turn two
 * lines into one run-on.
 *
 * ⚠️ `w-max`, not `w-fit`. Both draw the same box in open space, but `fit-content` resolves against
 * the room left between the bubble's own `left` and the edge of the viewport — so a wide hint near
 * the right edge measures as a narrow column, the clamp below flips it by that wrong width, and it
 * lands against the edge once it re-expands. `max-content` capped by `max-w-60` is the same width
 * wherever it is asked, which is what a measure-then-move engine needs.
 *
 * `rounded-control` rather than §3.4's overlay radius: this is furniture the size of a control, and
 * a 10px corner on a two-line bubble reads as a card that has lost its content.
 *
 * ⚠️ `inset-auto m-0` undo the UA stylesheet's own popover rules — see `Bubble`, which puts this in
 * the top layer. A popover is `inset: 0; margin: auto` by default, which centres it in the viewport;
 * with a `left` of ours and a `right` of theirs the box is over-constrained and the auto margins
 * quietly re-distribute the difference, so the bubble lands somewhere near the middle of the screen
 * instead of beside the pointer.
 */
const SURFACE =
  "pointer-events-none z-60 inset-auto m-0 w-max max-w-60 whitespace-pre-line rounded-control border border-chassis-border-strong bg-chassis-raised/90 px-2 py-1.5 text-micro leading-hint text-chassis-text shadow-menu backdrop-blur-[3px]";

/** Measure-then-position has to run before paint, or the clamp at a viewport edge is a visible
 *  jump. `useLayoutEffect` warns on the server, so the effect degrades there rather than firing. */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Kept in step with the `duration-150` below — the bubble has to know when it can unmount. */
const FADE_MS = 150;

/** The gap kept from the pointer, the gap kept from a focused trigger, and the viewport margin. */
const CURSOR_GAP = 16;
const FOCUS_GAP = 6;
const VIEWPORT_EDGE = 12;

type CursorModeProps = {
  /** The caller owns the pointer — charts, where the content is per-mark. */
  mode: "cursor";
  /** Where the pointer is, or `null` to hide. Fed from `useCursorHover`. */
  point: CursorPoint | null;
  /** The body. Safe to render unconditionally: the engine snapshots it before it fades out. */
  children: ReactNode;
  /** In px. Widen past the 240 default for the few bubbles carrying a paragraph. */
  maxWidth?: number;
};

type HoverModeProps = {
  /** Drives itself off the pointer over its own trigger — everything that is not a chart. */
  mode: "hover";
  children: ReactNode;
  /**
   * The body — **and nullable on purpose.**
   *
   * Half of these hints are conditional: a disabled control explains itself and an enabled one has
   * nothing to add, a truncated path needs its full form and a short one does not. With `null`
   * meaning "no tooltip" the caller wraps unconditionally and passes what it has, instead of
   * duplicating its own markup down both arms of a ternary.
   */
  content: ReactNode;
  /**
   * The wrapper's classes. It is a real box in the caller's layout — unlike Zeus's port, which
   * composes onto the child through Radix's `Slot`; there is no Radix here and one dependency for
   * one `span` is a poor trade. `inline-flex` is what the old component wrapped everything in, so
   * every call site it already had keeps its geometry by default.
   */
  className?: string;
  maxWidth?: number;
};

type TooltipProps = CursorModeProps | HoverModeProps;

/** What the bubble last showed, kept so it can fade OUT after `point` goes null and the caller has
 *  already stopped rendering a body. */
type Snapshot = {
  point: CursorPoint;
  children: ReactNode;
};

/**
 * The engine both modes share: portals to `<body>`, positions against a point, clamps inside the
 * viewport, and fades at both ends — the fade-out is why it holds a snapshot rather than reading
 * `children` straight through.
 *
 * The point is a pointer position in `cursor` mode, and either a pointer position or a corner of
 * the trigger's box in `hover` mode. Nothing here needs to know which: a point and a gap is the
 * whole interface, which is why keyboard support costs a rectangle rather than a second engine.
 */
const Bubble = ({
  point,
  gap,
  id,
  children,
  maxWidth,
}: {
  point: CursorPoint | null;
  gap: number;
  /** Set in `hover` mode, where the trigger points its `aria-describedby` at this. */
  id?: string;
  children: ReactNode;
  maxWidth?: number;
}) => {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Shown → capture the content. Hidden → fade, then unmount once the fade cannot still be running.
  useEffect(() => {
    if (point) {
      setSnapshot({ point, children });
      return;
    }

    setVisible(false);
    const timer = setTimeout(() => setSnapshot(null), FADE_MS + 40);
    return () => clearTimeout(timer);
  }, [point, children]);

  /**
   * Revealed on the frame after the box first exists, so a fresh mount has an opacity to transition
   * from rather than appearing at full strength.
   *
   * ⚠️ **Keyed on a boolean, and that is the fix rather than a detail of it.** The port schedules
   * this frame inside the effect above, whose deps change on every pointer move — so each move
   * cancels the frame the previous one queued, and a bubble that is being *swept* rather than
   * pointed at never reaches the frame that reveals it. Every chart here is swept: sixty buckets
   * across a log panel, twenty-four bars across a tile. `showing` flips once when the pointer
   * arrives and once when it leaves, so the frame is queued once and cancelled only by the leaving.
   */
  const showing = point !== null && snapshot !== null;

  useEffect(() => {
    if (!showing) return;
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, [showing]);

  useIsomorphicLayoutEffect(() => {
    const element = ref.current;
    if (!snapshot || !element) return;

    /*
     * **Into the top layer, and this is the one thing the port could not copy.**
     *
     * `Modal` here is a native `<dialog>` opened with `showModal()` (IKN-53), which promotes it to
     * the browser's top layer — painted above the whole document whatever any z-index says. Zeus,
     * PFA and bkmk all portal their bubble to `<body>` and get away with it because their dialogs
     * are ordinary divs; the same portal here renders *behind* an open modal, which is precisely
     * where three of these bubbles live (the trace timeline, the issue's chart, the alert's state
     * band).
     *
     * Portalling into the dialog instead is worse, not better: `ik-modal` animates `scale`, and an
     * element with a `scale` other than `none` is a containing block for `position: fixed`
     * descendants — every coordinate measured against the viewport would land offset by the card's
     * own position, and the card's overflow would clip what was left.
     *
     * A popover is the platform's answer. It joins the same top layer, later than the dialog and
     * therefore above it; it keeps the viewport as its containing block, so the clamp below stays
     * honest; and `manual` means no light dismiss and no focus, which is all a tooltip wants. On a
     * browser without the API the attribute is inert and the element is an ordinary fixed div —
     * the behaviour this had before, everywhere except over a modal.
     */
    if (typeof element.showPopover === "function" && !element.matches(":popover-open")) element.showPopover();

    // Flipped to the other side of the point rather than slid along the edge: a bubble pinned to
    // the right margin while the pointer keeps moving reads as stuck.
    const { width, height } = element.getBoundingClientRect();
    let left = snapshot.point.x + gap;
    if (left + width + VIEWPORT_EDGE > window.innerWidth) left = snapshot.point.x - gap - width;

    let top = snapshot.point.y + gap;
    if (top + height + VIEWPORT_EDGE > window.innerHeight) top = snapshot.point.y - gap - height;

    setPos({ left: Math.max(VIEWPORT_EDGE, left), top: Math.max(VIEWPORT_EDGE, top) });
  }, [snapshot, gap]);

  if (!snapshot) return null;

  /*
   * `document.body` and not a provider-mounted node: a tooltip has no state to share and nothing to
   * order itself against. Reached only past the `snapshot` guard above, which is `null` until an
   * effect runs, so a server render never touches `document`.
   */
  return createPortal(
    <div
      id={id}
      ref={ref}
      role="tooltip"
      /* Shown from the layout effect above, never from an attribute — a popover is `display: none`
         until `showPopover()`, so the two have to happen in the same frame the box is measured. */
      popover="manual"
      className={cn(SURFACE, "fixed transition-opacity duration-150 ease-out", visible ? "opacity-100" : "opacity-0")}
      style={{
        left: pos ? pos.left : snapshot.point.x + gap,
        top: pos ? pos.top : snapshot.point.y + gap,
        maxWidth,
      }}
    >
      {snapshot.children}
    </div>,
    document.body,
  );
};

/**
 * The self-driving form: the caller wraps a trigger and passes a body, and the wrapper does the
 * rest.
 *
 * ⚠️ **The hover state lives here, not in the caller.** A mousemove sets state at pointer rate; in
 * this wrapper that re-renders the wrapper and its portal and nothing else — `children` arrives as
 * the same element object every time, so React skips the subtree. Lifting the same state into the
 * view would re-render every row beside it, per pointer move.
 */
const HoverTooltip = ({ children, content, className, maxWidth }: HoverModeProps) => {
  const { hover, move, clear } = useCursorHover();
  const [focused, setFocused] = useState<CursorPoint | null>(null);
  const id = useId();

  const point = hover ?? focused;

  /**
   * ⚠️ `:focus-visible`, not focus. Clicking a button focuses it, and the pointer is already
   * driving the bubble — re-anchoring to the box mid-hover would make it jump under the cursor.
   *
   * ⚠️ And the test is on the **target**, not on `currentTarget`. Focus bubbles (`focusin`), and
   * the trigger here is a wrapper around whatever is focusable; a `<span>` never takes focus, so
   * asking whether *it* is focus-visible answers no on precisely the hints that need the keyboard.
   * The box still comes from the wrapper, which is what the bubble is describing.
   */
  const anchor = (event: FocusEvent<HTMLElement>) => {
    if (!(event.target instanceof HTMLElement) || !event.target.matches(":focus-visible")) return;

    const rect = event.currentTarget.getBoundingClientRect();
    setFocused({ x: rect.left, y: rect.bottom });
  };

  // Escape closes it. The trigger holds focus for as long as the bubble is up, so the key event
  // passes through here on its way out — no listener on the document.
  const dismiss = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") setFocused(null);
  };

  // Nothing to say — hand the children back untouched. Not an empty bubble, and not a live wrapper
  // either: that would still bind handlers and still open on focus, so a keyboard user would tab
  // into a tooltip made of nothing. The hooks above run either way, which is why they run first.
  if (nothingToSay(content)) return <>{children}</>;

  return (
    <>
      {/* ⚠️ Both `onMouseMove` and `onMouseEnter`. Move alone loses the pointer that lands on a
          trigger and stops, and the trigger that arrives under a pointer already at rest. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a wrapper, not a control — the trigger
          inside keeps its own role, and the keyboard reaches this through `onFocus`/`onKeyDown`
          rather than through the pointer handlers the rule is about */}
      <span
        aria-describedby={point ? id : undefined}
        className={cn("inline-flex", className)}
        onBlur={() => setFocused(null)}
        onFocus={anchor}
        onKeyDown={dismiss}
        onMouseEnter={move()}
        onMouseLeave={clear}
        onMouseMove={move()}
      >
        {children}
      </span>
      <Bubble
        gap={hover ? CURSOR_GAP : FOCUS_GAP}
        id={id}
        maxWidth={maxWidth}
        point={point}
      >
        {content}
      </Bubble>
    </>
  );
};

/**
 * Nothing to say, in the four shapes a caller's ternary produces.
 *
 * Checked in the component rather than at every call site because the *charts* are where it
 * matters: a strip resolves the mark under the pointer and asks its caller what to write about it,
 * and an interval nobody scraped has no answer. Without this, that mark opens an empty bubble —
 * a two-line box of blur that follows the cursor and says nothing, which reads as a rendering
 * fault rather than as an absence.
 */
const nothingToSay = (content: ReactNode): boolean =>
  content === null || content === undefined || content === "" || content === false;

export const Tooltip = (props: TooltipProps) =>
  props.mode === "cursor" ? (
    <Bubble
      gap={CURSOR_GAP}
      maxWidth={props.maxWidth}
      point={nothingToSay(props.children) ? null : props.point}
    >
      {props.children}
    </Bubble>
  ) : (
    <HoverTooltip {...props} />
  );

/** One measurement, in the block below. */
export type TooltipRow = {
  /**
   * The left column. Lowercase and unpunctuated — `error`, `of used`, `duration`. These are table
   * labels rather than sentences, and they are read as a column rather than one at a time.
   */
  label: string;
  value: ReactNode;
  /**
   * A second value column, for the marks that measure a count **and** its share of a whole. Set it
   * on no row and the column does not exist — an empty third cell would be a dead margin down the
   * right of every other block.
   */
  extra?: ReactNode;
};

/**
 * What a chart mark says: a subject, an optional line of context, and label/value rows.
 *
 * One shape for every mark in the product, so they cannot drift into a dozen layouts. Deliberately
 * not a framework — no variants, no `kind`. The moment this grows a `variant` prop it has stopped
 * being a shape. Which rows to render, and whether there are any, is the caller's business: an
 * interval with nothing to report passes a `context` and no rows at all.
 *
 * **A self-scaled mark never says what its height is worth**, which is the fact these blocks exist
 * to supply. A sparkline peak halfway up a 26px tile is 40 req/s on one tile and 4 on the next, and
 * until the number is written down there is no axis anywhere on the screen.
 *
 * Values are right-aligned in their own column so they compare *down* the block, and `tabular-nums`
 * lines up the digits — nearly everything here is a count, a percentage or a duration.
 */
export const TooltipBlock = ({
  subject,
  context,
  rows = [],
}: {
  subject: ReactNode;
  /** The interval and what backs it — `5 min bucket`, `48 h · 24 readings` — or why there is nothing
   *  to tabulate. */
  context?: ReactNode;
  rows?: TooltipRow[];
}) => {
  const wide = rows.some((row) => row.extra !== undefined);

  return (
    <div className="flex flex-col">
      <div className="text-row font-medium text-chassis-text-bright">{subject}</div>
      {context ? <div className="text-chassis-text-dim">{context}</div> : null}

      {rows.length > 0 ? (
        // Padding rather than `gap-x`, so the columns keep their spacing without the grid reserving
        // one at the right edge for a cell that is not there.
        <div className={cn("mt-1 grid gap-y-0.5", wide ? "grid-cols-[auto_1fr_auto]" : "grid-cols-[auto_1fr]")}>
          {rows.map((row) => (
            <Fragment key={row.label}>
              <div className="pr-4 text-chassis-text-dim">{row.label}</div>
              <div className="text-right tabular-nums text-chassis-text">{row.value}</div>
              {wide ? <div className="pl-3 text-right tabular-nums text-chassis-text">{row.extra}</div> : null}
            </Fragment>
          ))}
        </div>
      ) : null}
    </div>
  );
};
