import { describe, expect, it } from "vitest";
import { actionFor, preventsDefault } from "./keymap";

import type { KeyContext, KeyLike } from "./keymap";

const key = (over: Partial<KeyLike>): KeyLike => ({
  key: "a",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
});

const IDLE: KeyContext = { modalOpen: false, typing: false, hasTextSelection: false };

describe("actionFor — the table of §6", () => {
  it("moves the selection on j/k and the arrows alike", () => {
    expect(actionFor(key({ key: "j" }), IDLE)).toEqual({ kind: "command", name: "selection.next" });
    expect(actionFor(key({ key: "ArrowDown" }), IDLE)).toEqual({ kind: "command", name: "selection.next" });
    expect(actionFor(key({ key: "k" }), IDLE)).toEqual({ kind: "command", name: "selection.prev" });
    expect(actionFor(key({ key: "ArrowUp" }), IDLE)).toEqual({ kind: "command", name: "selection.prev" });
  });

  it("opens the row on enter and opens the trace on ⌥⏎", () => {
    expect(actionFor(key({ key: "Enter" }), IDLE)).toEqual({ kind: "command", name: "selection.open" });
    expect(actionFor(key({ key: "Enter", altKey: true }), IDLE)).toEqual({ kind: "command", name: "selection.trace" });
  });

  it("focuses the query bar on /", () => {
    expect(actionFor(key({ key: "/" }), IDLE)).toEqual({ kind: "command", name: "query.focus" });
  });

  it("opens the palette on ⌘K, and on ctrl-K for anyone not on a Mac", () => {
    expect(actionFor(key({ key: "k", metaKey: true }), IDLE)).toEqual({ kind: "chrome", action: "palette" });
    expect(actionFor(key({ key: "k", ctrlKey: true }), IDLE)).toEqual({ kind: "chrome", action: "palette" });
  });

  it("tells ⌘⇧L from ⌘L, and checks the shift first", () => {
    // Read in the other order, signing out is unreachable: ⌘⇧L matches ⌘L and goes fullscreen.
    expect(actionFor(key({ key: "l", metaKey: true }), IDLE)).toEqual({ kind: "chrome", action: "fullscreenLogs" });
    expect(actionFor(key({ key: "L", metaKey: true, shiftKey: true }), IDLE)).toEqual({
      kind: "chrome",
      action: "logout",
    });
  });

  it("takes ⌘C only when the browser would have copied nothing", () => {
    expect(actionFor(key({ key: "c", metaKey: true }), IDLE)).toEqual({ kind: "command", name: "selection.copy" });
    // Copying a message out of a log line is the most ordinary thing on this screen.
    expect(actionFor(key({ key: "c", metaKey: true }), { ...IDLE, hasTextSelection: true })).toBeNull();
  });

  it("opens the issue of the selected row on ⌘I", () => {
    expect(actionFor(key({ key: "i", metaKey: true }), IDLE)).toEqual({ kind: "command", name: "selection.issue" });
    // `ctrl` everywhere else, like every other entry in the table.
    expect(actionFor(key({ key: "i", ctrlKey: true }), IDLE)).toEqual({ kind: "command", name: "selection.issue" });
  });

  it("ignores a ⌘ combination it does not claim", () => {
    expect(actionFor(key({ key: "r", metaKey: true }), IDLE)).toBeNull();
    expect(actionFor(key({ key: "j", metaKey: true }), IDLE)).toBeNull();
  });

  it("ignores a bare alt combination that is not ⌥⏎", () => {
    expect(actionFor(key({ key: "j", altKey: true }), IDLE)).toBeNull();
  });
});

describe("actionFor — where nothing may fire", () => {
  const TYPING: KeyContext = { ...IDLE, typing: true };
  const MODAL: KeyContext = { ...IDLE, modalOpen: true };

  it("lets esc through from a field and from a modal, because it is how you leave both", () => {
    expect(actionFor(key({ key: "Escape" }), TYPING)).toEqual({ kind: "chrome", action: "close" });
    expect(actionFor(key({ key: "Escape" }), MODAL)).toEqual({ kind: "chrome", action: "close" });
  });

  it("fires nothing else while someone is typing", () => {
    // `j` in the query bar is a letter, not a movement.
    for (const k of [key({ key: "j" }), key({ key: "/" }), key({ key: "Enter" }), key({ key: "k", metaKey: true })]) {
      expect(actionFor(k, TYPING)).toBeNull();
    }
  });

  it("fires nothing else while a modal is open", () => {
    for (const k of [
      key({ key: "j" }),
      key({ key: "k", metaKey: true }),
      key({ key: "Enter", altKey: true }),
      // ⌘I especially: the row detail *is* a modal since IKN-60, so this is why that panel reaches
      // its issue through a button in its own footer rather than through the shortcut.
      key({ key: "i", metaKey: true }),
    ]) {
      expect(actionFor(k, MODAL)).toBeNull();
    }
  });
});

describe("preventsDefault", () => {
  it("suppresses the browser for the two shortcuts it would otherwise steal", () => {
    // Without this ⌘L opens the address bar and the most visible shortcut on screen does nothing.
    expect(preventsDefault(actionFor(key({ key: "l", metaKey: true }), IDLE))).toBe(true);
    expect(preventsDefault(actionFor(key({ key: "k", metaKey: true }), IDLE))).toBe(true);
    // And ⌘I, which is the developer tools in Chrome and the page info panel in Firefox.
    expect(preventsDefault(actionFor(key({ key: "i", metaKey: true }), IDLE))).toBe(true);
  });

  it("suppresses the scroll that would move the list under the selection", () => {
    expect(preventsDefault(actionFor(key({ key: "ArrowDown" }), IDLE))).toBe(true);
    expect(preventsDefault(actionFor(key({ key: "/" }), IDLE))).toBe(true);
  });

  it("leaves esc alone, so a native dialog still closes itself", () => {
    expect(preventsDefault(actionFor(key({ key: "Escape" }), IDLE))).toBe(false);
  });

  it("leaves an unclaimed key alone", () => {
    expect(preventsDefault(actionFor(key({ key: "r", metaKey: true }), IDLE))).toBe(false);
  });
});
