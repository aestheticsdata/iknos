/**
 * The keyboard table of §6, as one pure function.
 *
 * Separated from the listener because this is where the ticket's rules actually live — what fires
 * while a modal is open, what fires while someone is typing, which of two overlapping combinations
 * wins — and every one of them is a rule that is easy to get subtly wrong and impossible to notice
 * afterwards. A function over a plain object can be tested exhaustively without a DOM; a listener
 * cannot.
 */

/** Just enough of a `KeyboardEvent` to decide. */
export type KeyLike = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

/**
 * Commands a **view** answers. The chrome holds the listener but owns none of this state — the
 * selection belongs to the log list, the query bar owns its own focus — so these are dispatched
 * through the registry and simply do nothing on a page that has not registered them.
 */
export type CommandName =
  | "selection.next"
  | "selection.prev"
  | "selection.open"
  | "selection.trace"
  | "selection.copy"
  | "query.focus";

/** What the chrome itself does, which needs no registration. */
export type ChromeAction = "palette" | "fullscreenLogs" | "logout" | "close";

export type KeyAction = { kind: "command"; name: CommandName } | { kind: "chrome"; action: ChromeAction } | null;

export type KeyContext = {
  /** A modal is open. Only `esc` acts. */
  modalOpen: boolean;
  /** Focus is in an input, textarea, select or contenteditable. Only `esc` acts. */
  typing: boolean;
  /**
   * There is a text selection on the page.
   *
   * `⌘C` is the one shortcut that collides with something the browser does well. Taking it while
   * text is selected would break copying a message out of a log line — the single most ordinary
   * thing anyone does on this screen — so the row-as-NDJSON copy only applies when the native
   * action would have copied nothing.
   */
  hasTextSelection: boolean;
};

/** `⌘` on a Mac, `ctrl` everywhere else. Accepting both costs nothing and the legend says `⌘`. */
const cmd = (e: KeyLike): boolean => e.metaKey || e.ctrlKey;

const command = (name: CommandName): KeyAction => ({ kind: "command", name });
const chrome = (action: ChromeAction): KeyAction => ({ kind: "chrome", action });

export function actionFor(e: KeyLike, ctx: KeyContext): KeyAction {
  // `esc` first and unconditionally — it is the one key that has to work from inside a modal and
  // from inside a field, because it is how you leave both.
  if (e.key === "Escape") return chrome("close");

  // Everything below is suppressed in the two states where the keystroke belongs to something
  // else: a modal has the reader's whole attention, and a field has their letters.
  if (ctx.modalOpen || ctx.typing) return null;

  if (cmd(e)) {
    const key = e.key.toLowerCase();
    // Before the bare `⌘L`, or signing out would only ever be read as "fullscreen logs".
    if (key === "l" && e.shiftKey) return chrome("logout");
    if (key === "l") return chrome("fullscreenLogs");
    if (key === "k") return chrome("palette");
    if (key === "c") return ctx.hasTextSelection ? null : command("selection.copy");
    return null;
  }

  // A bare modifier-less table. `altKey` is the exception, and it is checked before plain Enter
  // for the same reason `shift` is checked before plain `⌘L`.
  if (e.key === "Enter") return e.altKey ? command("selection.trace") : command("selection.open");
  if (e.altKey) return null;

  if (e.key === "j" || e.key === "ArrowDown") return command("selection.next");
  if (e.key === "k" || e.key === "ArrowUp") return command("selection.prev");
  if (e.key === "/") return command("query.focus");

  return null;
}

/**
 * Whether the browser's own behaviour has to be suppressed for this keystroke.
 *
 * `⌘L` opens the address bar and `⌘K` is a search shortcut in most browsers, so the two most
 * visible entries in the on-screen legend would silently do nothing without this. The arrows and
 * `j`/`k` scroll the list out from under the selection they are supposed to be moving, and `/`
 * opens quick-find in Firefox.
 *
 * `esc` is deliberately **not** here: it also closes a native `<dialog>`, and `Modal` relies on
 * that — the element fires `close`, which is routed back through `onClose`. Preventing it would
 * leave the DOM and the caller's state disagreeing about what is on screen.
 */
export const preventsDefault = (action: KeyAction): boolean =>
  action !== null && !(action.kind === "chrome" && action.action === "close");
