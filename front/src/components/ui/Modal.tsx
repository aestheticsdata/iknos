"use client";

import { useModalOpen } from "@lib/commandState";
import { cn } from "@lib/utils";
import { useEffect, useRef } from "react";

/**
 * Whether a click landed on `::backdrop` rather than on the card — IKN-60.
 *
 * `<dialog>`'s own box is exactly its content (`p-0` below, no wrapping div), so a click inside the
 * visible card always reports one of its children as `target`; only a click genuinely outside that
 * box — on the backdrop pseudo-element, which cannot be a target in its own right — reports the
 * `<dialog>` itself. That is what lets one click handler on the element tell the two apart without
 * measuring anything.
 */
export const isBackdropClick = (event: { target: EventTarget | null }, dialog: EventTarget | null): boolean =>
  dialog !== null && event.target === dialog;

/**
 * The modal chassis — tag, title, `esc`, body, hint line, actions (§5.6).
 *
 * Built on native `<dialog>`, which brings the focus trap, the inert background, restoring focus
 * to whatever opened it, and Esc — four things a div reimplements badly. The Esc *hint* is still
 * drawn, because the affordance is invisible otherwise.
 *
 * Always the chassis surface, on every screen: §3.1 gives elevation to what overhangs, and a modal
 * is the clearest case. It does not take a `surface` prop for that reason.
 *
 * It arrives and leaves rather than blinking (IKN-53) — `ik-modal` carries the whole gesture, and
 * because a native `<dialog>` can be closed by the platform without React hearing about it, that
 * class is also what makes the *exit* exist at all. The rationale is in `utilities.css`; what it
 * costs here is one class and the latch below.
 *
 * **No click-to-dismiss on the backdrop, by default.** These carry real actions — acknowledge an
 * alert, close an issue — and a stray click beside the card should not be one of them. The ways out
 * are Esc and a button, both of them deliberate.
 *
 * `closeOnBackdropClick` is the opt-in for a caller with nothing to protect — IKN-60's log detail is
 * read-only, so a stray click costing nothing is exactly what a reader expects from a panel with no
 * action in it. Off by default rather than an opt-out on the common case, because a modal guarding a
 * real action is the ordinary caller here and the unsafe choice should never be the one nobody had
 * to ask for.
 */
export const Modal = ({
  open,
  onClose,
  closeOnBackdropClick,
  tag,
  title,
  hint,
  actions,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** See `closeOnBackdropClick` in the class doc above. Only IKN-60's log detail sets this. */
  closeOnBackdropClick?: boolean;
  tag?: string;
  title: string;
  hint?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) => {
  const ref = useRef<HTMLDialogElement>(null);

  /*
   * What the modal keeps showing while it is leaving — IKN-53.
   *
   * The card is on screen for 200ms after `open` goes false, and a caller whose content *is* its
   * open state empties it in that same render: `TraceTimeline` derives `open` from
   * `loading || error || trace`, so closing the timeline blanks the body and empties the title in
   * the first frame of the exit. What used to be invisible becomes a flicker the moment there is
   * an exit to see.
   *
   * Latched here rather than in that one caller, for the reason every other invariant in this file
   * is here: the next modal with derived content should not have to know that closing takes a fifth
   * of a second. Callers with an `open` of their own — the storage card, the design page — latch to
   * the same values they were already rendering and cannot tell the difference.
   *
   * ⚠️ **Committed in an effect, not during render.** The React Compiler is on, and a ref written
   * mid-render is exactly what it is not required to keep in order. The effect runs when an open
   * render commits, so a later closing render reads the props that were last actually on screen.
   */
  const shown = useRef({ tag, title, hint, actions, children });

  useEffect(() => {
    if (open) shown.current = { tag, title, hint, actions, children };
  });

  const view = open ? { tag, title, hint, actions, children } : shown.current;

  /*
   * Every overlay in the application goes through this component, so declaring it here is what
   * makes "under a modal, only `esc` acts" (IKN-22) true by construction rather than by each
   * modal's author having remembered to opt in.
   */
  useModalOpen(open);

  /*
   * Deliberately without a dependency array: this reconciles the DOM against the prop, and the DOM
   * can change without the prop doing so.
   *
   * Esc closes the dialog natively. If the caller's `open` is derived — `loading || error || data`
   * is the obvious shape for anything that fetches — it can still be `true` at that moment, and
   * with `[open]` deps the effect never re-runs: React sees no change, while `dialog.open` has
   * silently become `false`. The modal is then dead for the rest of the session, and nothing
   * anywhere reports it. Re-asserting every render is idempotent, costs two boolean reads, and
   * makes the prop the single source of truth it was always documented to be.
   */
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // `showModal()` rather than the `open` attribute: only the former makes the rest of the page
    // inert and traps focus. Setting `open` renders a dialog that looks modal and is not.
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: not a control, only detects a backdrop click — Esc reaches onClose natively
    <dialog
      ref={ref}
      // Esc closes natively and fires `close`; routing it back through `onClose` keeps the caller's
      // state from drifting out of step with what is on screen.
      onClose={onClose}
      // Calling `.close()` here rather than `onClose()` directly sends a backdrop click down the
      // same native `close` event Esc already fires, instead of a second path to the caller that
      // could drift out of step with the first.
      onClick={(event) => {
        if (closeOnBackdropClick && isBackdropClick(event, ref.current)) ref.current?.close();
      }}
      className={cn(
        "ik-modal m-auto w-[min(560px,calc(100vw-2rem))] rounded-overlay border border-chassis-border-strong",
        "bg-chassis-surface p-0 font-mono text-chassis-text shadow-overlay backdrop:bg-chassis-inset/70",
      )}
    >
      <header className="flex items-baseline gap-2 border-b border-chassis-border px-3 py-2">
        {view.tag && <span className="text-kicker tracking-kicker text-chassis-text-dim uppercase">{view.tag}</span>}
        <h2 className="font-sans text-ui font-medium text-chassis-text-bright">{view.title}</h2>
        <span className="ml-auto text-kicker tracking-kicker text-chassis-text-dim">esc</span>
      </header>

      <div className="px-3 py-3 text-ui">{view.children}</div>

      {(view.hint || view.actions) && (
        <footer className="flex items-center gap-3 border-t border-chassis-border px-3 py-2">
          {view.hint && <span className="text-micro text-chassis-text-dim">{view.hint}</span>}
          {view.actions && <div className="ml-auto flex items-center gap-2">{view.actions}</div>}
        </footer>
      )}
    </dialog>
  );
};
