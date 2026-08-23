"use client";

import { useFilterOff } from "@lib/logQuery";
import { DEFAULT_RANGE, RANGE_KEYS } from "@lib/timeRange";
import { parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { useCallback } from "react";

/**
 * The two things the rail scopes everything by, both in the URL — §4.
 *
 * The rail is *scoping*: picking a service reconfigures every view, so the selection cannot live
 * in a component. Putting it in the query string rather than in a context also means the back
 * button walks the history of what was being looked at, which is the behaviour anyone debugging
 * at 3am reaches for without thinking about it.
 */

/**
 * `null` means every service — the rail's `all` row, and the default.
 *
 * **Selecting also switches the filter back on** (IKN-35). `service` is one parameter with two
 * writers by design — the rail here, and the log view's token bar through `useLogQueryState` —
 * but the value travels with a companion flag naming the filters currently switched off, and
 * `buildLogQuery` sends nothing for a key listed there. A writer that set the value alone left the
 * pair inconsistent: once the chip had been switched off, every later rail click wrote a `service`
 * that was never sent, so the rail scoped nothing and said nothing about why — and because the
 * state is the URL, that survived a reload and travelled in a shared link.
 *
 * So the setter maintains exactly the invariant the token bar's own `setValue` and `clear` do:
 * naming a value switches its key on, and `all` clears the flag rather than leaving it orphaned
 * for the next selection to inherit. Doing it here rather than in the rail means the next caller —
 * the service view (IKN-13), the ⌘K palette (IKN-22) — inherits it instead of rediscovering it.
 */
export const useSelectedService = (): [string | null, (next: string | null) => void] => {
  const [service, setService] = useQueryState("service", parseAsString);
  const [, setOff] = useFilterOff();

  const select = useCallback(
    (next: string | null) => {
      // Two setters, one URL update: nuqs batches the writes queued in a single event, so this is
      // one history entry and not a selection the back button has to be pressed twice to undo.
      void setService(next);
      void setOff((current) => current.filter((key) => key !== "service"));
    },
    [setService, setOff],
  );

  return [service, select];
};

export const useTimeRange = () => useQueryState("range", parseAsStringLiteral(RANGE_KEYS).withDefault(DEFAULT_RANGE));

/** Written to the URL only when the tiles are hidden, so an ordinary link stays clean. */
const SIGNALS_STATES = ["on", "off"] as const;

/**
 * Whether the signal tiles are showing — IKN-13, after the two views were folded into one.
 *
 * In the URL like everything else, and for the same three reasons: the back button walks it, a
 * shared link arrives in the state it was sent in, and the header button and `⌘L` are two writers
 * of one fact rather than two components each holding their own idea of it.
 *
 * It says nothing about whether there are tiles *to* show. That depends on a service being
 * selected, which is `useSelectedService`, and folding the two together here would mean the reader
 * silently lost their choice every time they passed through `all`.
 */
export const useSignalsOpen = (): [boolean, () => void] => {
  const [state, setState] = useQueryState("signals", parseAsStringLiteral(SIGNALS_STATES).withDefault("on"));

  const toggle = useCallback(() => {
    void setState((current) => (current === "off" ? "on" : "off"));
  }, [setState]);

  return [state !== "off", toggle];
};
