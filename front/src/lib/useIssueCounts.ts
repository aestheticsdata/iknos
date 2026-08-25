"use client";

import { api } from "@lib/api";
import { useSelectedService } from "@lib/chassisState";
import { ISSUES_POLL_MS } from "@lib/useIssues";
import { createContext, createElement, useContext, useEffect, useState } from "react";

import type { IssueCounts } from "@lib/issueTypes";

/**
 * The three segment counts, polled once for the whole chassis.
 *
 * **This was three call sites polling one URL.** `usePolledResource` has no shared cache, so the
 * rail's badge and whichever issues surface was mounted — the panel on `/logs`, the segments on
 * `/issues` — each fetched the same counts on their own timer, in parallel, forever. Two requests
 * for one number, and worse, two numbers that could differ by a tick while claiming to be the same
 * count. Exactly the failure `AlertCountsProvider` was written to avoid; issues simply predates it.
 *
 * **Scoped to the rail's selection, unlike the alerts counter beside it**, and the asymmetry is
 * deliberate. The rail says its selection re-scopes every view, and the issues badge is a quantity
 * *of this service's* issues — it narrows with everything else on screen. The alerts counter is a
 * warning in permanent chrome and stays fleet-wide, because a warning that quietly narrowed would
 * be the one number answering a different question from the rest of the bar.
 *
 * That is why this provider reads the selection itself rather than taking it as a prop: it is the
 * same selection all three readers were already passing in, and reading it once is what makes them
 * agree by construction.
 */

export type IssueCountsState = {
  /** `null` until the first answer. Nothing renders a count before then — a `0` is a claim. */
  counts: IssueCounts | null;
};

const EMPTY: IssueCountsState = { counts: null };

const IssueCountsContext = createContext<IssueCountsState>(EMPTY);

export const IssueCountsProvider = ({ children }: { children: React.ReactNode }) =>
  // `createElement` rather than JSX because this file is `.ts`, exactly as `useCollector` does.
  createElement(IssueCountsContext.Provider, { value: usePolledCounts() }, children);

/**
 * Falls back to the empty state outside a provider rather than throwing — the auth screens render
 * chassis primitives with no chassis around them, and "no number yet" is the truth there.
 */
export const useIssueCounts = (): IssueCountsState => useContext(IssueCountsContext);

function usePolledCounts(): IssueCountsState {
  const [selected] = useSelectedService();
  const [state, setState] = useState<IssueCountsState>(EMPTY);

  useEffect(() => {
    let live = true;
    // Cleared on a scope change, so the rail never shows the previous service's count under the
    // new service's name while the answer travels.
    setState(EMPTY);

    const url = selected === null ? "/issues/counts" : `/issues/counts?service=${encodeURIComponent(selected)}`;

    const load = async () => {
      try {
        const { data } = await api(url);
        if (live) setState({ counts: data as IssueCounts });
      } catch {
        // Silent, like the alerts counter: this is chrome. A failed poll leaves the last good
        // number on screen and tries again rather than replacing a count with an apology.
      }
    };

    void load();

    // Visible tabs only — this app is left open all day, and a hidden tab has nobody to inform.
    const tick = () => {
      if (document.visibilityState === "visible") void load();
    };
    const id = setInterval(tick, ISSUES_POLL_MS);
    document.addEventListener("visibilitychange", tick);

    return () => {
      live = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [selected]);

  return state;
}
