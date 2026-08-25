"use client";

import { api } from "@lib/api";
import { ALERTS_POLL_MS } from "@lib/useAlerts";
import { createContext, createElement, useContext, useEffect, useState } from "react";

import type { AlertCounts } from "@lib/alertTypes";

/**
 * How many alerts want attention, polled once for the whole chassis (IKN-15 §4).
 *
 * **One poll, two readers**, and the ticket asks for exactly that: the rail's badge and the status
 * bar's counter must show the same number, served by the same route. Two `usePolledResource` call
 * sites against one URL would satisfy the letter of it and still drift — the hook has no shared
 * cache, so the two would fetch a few seconds apart and could disagree across a tick. A provider is
 * what makes "the same number" structural rather than lucky.
 *
 * This is the `CollectorProvider` shape, for the same reason it exists: a dot and a card
 * disagreeing about the collector is not a question the interface should make anyone arbitrate.
 *
 * **Fleet-wide, never scoped to the rail's selection.** The badge on a view entry says how many
 * alerts there are, and a counter in permanent chrome that quietly narrowed when someone picked a
 * service would be the one number on screen answering a different question from the rest. The
 * alerts view itself scopes; the chrome does not.
 */

export type AlertCountsState = {
  counts: AlertCounts | null;
  /** How many need attention across every severity — what both readers actually print. */
  total: number | null;
};

const EMPTY: AlertCountsState = { counts: null, total: null };

const AlertCountsContext = createContext<AlertCountsState>(EMPTY);

export const AlertCountsProvider = ({ children }: { children: React.ReactNode }) =>
  // `createElement` rather than JSX because this file is `.ts`, exactly as `useCollector` does.
  createElement(AlertCountsContext.Provider, { value: usePolledCounts() }, children);

/**
 * Falls back to the empty state outside a provider rather than throwing — the auth screens render
 * chassis primitives with no chassis around them, and "no number yet" is the truth there.
 *
 * **Nothing renders while it is null.** A `0` is a claim, and a badge that said it before the first
 * answer arrived would be reassurance nobody checked.
 */
export const useAlertCounts = (): AlertCountsState => useContext(AlertCountsContext);

function usePolledCounts(): AlertCountsState {
  const [state, setState] = useState<AlertCountsState>(EMPTY);

  useEffect(() => {
    let live = true;

    const load = async () => {
      try {
        const { data } = await api("/alerts/counts");
        if (!live) return;

        const counts = data as AlertCounts;
        setState({ counts, total: counts.critical + counts.warning + counts.info });
      } catch {
        // Silent. This is permanent chrome: a failed poll leaves the last good number on screen
        // and tries again, rather than replacing a count with an apology in the corner of the app.
      }
    };

    void load();

    // Visible tabs only, for the reason `usePolledResource` gives — this app is left open all day.
    const tick = () => {
      if (document.visibilityState === "visible") void load();
    };
    const id = setInterval(tick, ALERTS_POLL_MS);
    document.addEventListener("visibilitychange", tick);

    return () => {
      live = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  return state;
}
