"use client";

import { actionFor, preventsDefault } from "@lib/keymap";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import type { ChromeAction, CommandName } from "@lib/keymap";

/**
 * The keyboard, mounted once (IKN-22).
 *
 * **One listener for the whole application, in the chrome, never page by page.** The ticket asks
 * for this in as many words and the reason is not tidiness: two pages that each bind `j` do not
 * fail loudly, they both run, and the bug surfaces as a selection that moves two rows at a time on
 * exactly one route. A single listener also means the rules about modals and text fields are
 * decided in one place instead of being re-remembered by every page that adds a shortcut.
 *
 * The chrome holds the listener but owns almost none of the state the shortcuts act on — the
 * selection belongs to the log list, the query bar owns its own focus. So views register handlers
 * here and the listener dispatches to whatever is mounted. A command nobody has registered is a
 * key that does nothing, which is the correct behaviour on a page that has no list to move through.
 */

type Handler = () => void;

/** Stable for the life of the provider, so registering never re-renders a consumer. */
type CommandBus = {
  register: (name: CommandName, handler: Handler) => () => void;
  openModal: () => () => void;
  openPalette: () => void;
  closePalette: () => void;
};

/** Changes with the chrome's own state, and is read by the status bar and the palette. */
type ChromeState = {
  mode: "NORMAL" | "MODAL";
  paletteOpen: boolean;
};

const BusContext = createContext<CommandBus | null>(null);
const StateContext = createContext<ChromeState>({ mode: "NORMAL", paletteOpen: false });

/** A field has the reader's letters; only `esc` may be taken from it. */
const isTyping = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
};

const hasTextSelection = (): boolean => (window.getSelection()?.toString().length ?? 0) > 0;

export const CommandProvider = ({
  children,
  onChromeAction,
}: {
  children: React.ReactNode;
  /** `fullscreenLogs` and `logout` need the router and the session; the chassis supplies them. */
  onChromeAction: (action: ChromeAction) => void;
}) => {
  /*
   * A ref, not state. Handlers are re-created on most renders of the view that owns them — they
   * close over the current selection — so storing them in state would re-render every consumer of
   * this context on every keystroke that moved the cursor.
   */
  const handlers = useRef(new Map<CommandName, Handler>());

  /**
   * How many modals are open, not whether one is.
   *
   * A count rather than a boolean because they nest in practice: the trace timeline is reachable
   * from a row, and closing one of two open overlays must not put the chassis back into NORMAL
   * while the other is still covering the screen.
   */
  const [modals, setModals] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  const register = useCallback((name: CommandName, handler: Handler) => {
    handlers.current.set(name, handler);
    return () => {
      // Only if it is still ours. Two views mounting in sequence — a navigation — would otherwise
      // have the outgoing one's cleanup delete the incoming one's handler.
      if (handlers.current.get(name) === handler) handlers.current.delete(name);
    };
  }, []);

  const openModal = useCallback(() => {
    setModals((n) => n + 1);
    return () => setModals((n) => Math.max(0, n - 1));
  }, []);

  /*
   * The action callback is held in a ref so the listener can be attached once, with no
   * dependencies. Bound directly it would be torn down and re-attached on every render of the
   * chassis, which is a keydown listener being replaced under the reader's fingers.
   */
  const chromeAction = useRef(onChromeAction);
  chromeAction.current = onChromeAction;

  const modalOpen = modals > 0 || paletteOpen;
  const modalRef = useRef(modalOpen);
  modalRef.current = modalOpen;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = actionFor(event, {
        modalOpen: modalRef.current,
        typing: isTyping(event.target),
        hasTextSelection: hasTextSelection(),
      });
      if (action === null) return;

      if (preventsDefault(action)) event.preventDefault();

      if (action.kind === "chrome") {
        // The palette's open flag lives in this provider, so both actions that touch it are
        // answered here and never handed outwards. Only `fullscreenLogs` and `logout` need the
        // router and the session, and only those reach the chassis.
        if (action.action === "palette") setPaletteOpen(true);
        else if (action.action === "close") setPaletteOpen(false);
        else chromeAction.current(action.action);
        return;
      }

      handlers.current.get(action.name)?.();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const bus = useMemo<CommandBus>(
    () => ({ register, openModal, openPalette, closePalette }),
    [register, openModal, openPalette, closePalette],
  );
  const state = useMemo<ChromeState>(
    () => ({ mode: modalOpen ? "MODAL" : "NORMAL", paletteOpen }),
    [modalOpen, paletteOpen],
  );

  return (
    <BusContext.Provider value={bus}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </BusContext.Provider>
  );
};

/**
 * Bind a command for as long as this component is mounted.
 *
 * The handler is kept in a ref, so a view may pass an inline closure over its current selection
 * without re-registering on every render — which is what every caller will naturally write.
 */
export const useCommand = (name: CommandName, handler: Handler): void => {
  const bus = useContext(BusContext);
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => {
    if (bus === null) return;
    return bus.register(name, () => latest.current());
  }, [bus, name]);
};

/**
 * Declare that this component is covering the screen while `open`.
 *
 * Called by `Modal`, so every overlay in the application counts without its author having to
 * remember — the rule that only `esc` acts under a modal is then true because it is enforced in
 * one place rather than because each modal opted in.
 */
export const useModalOpen = (open: boolean): void => {
  const bus = useContext(BusContext);

  useEffect(() => {
    if (bus === null || !open) return;
    return bus.openModal();
  }, [bus, open]);
};

/** Falls back to a no-op outside a provider: the auth screens render `Modal` with no chassis. */
export const usePalette = (): { open: boolean; show: () => void; hide: () => void } => {
  const bus = useContext(BusContext);
  const { paletteOpen } = useContext(StateContext);

  return {
    open: paletteOpen,
    show: bus?.openPalette ?? (() => {}),
    hide: bus?.closePalette ?? (() => {}),
  };
};

/** `NORMAL` or `MODAL`, for the status bar's first cell. */
export const useChromeMode = (): "NORMAL" | "MODAL" => useContext(StateContext).mode;
