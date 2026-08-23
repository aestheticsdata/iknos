"use client";

import { api, readApiError } from "@lib/api";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * One JSON route, fetched and kept current — the shape both service-view hooks needed and neither
 * deserved its own copy of (IKN-13).
 *
 * The three things it exists to get right are the three `useHistogram` spells out at length for the
 * log chart, and they are the same here:
 *
 * - **Answers arriving out of order.** Two ranges chosen in quick succession — the usual way a range
 *   is chosen, by clicking `1h` and then `24h` — answer out of order often enough to matter, and
 *   the loser painting last leaves the previous window's numbers under the current window's label.
 *   Every response checks the generation it was started in before it writes.
 * - **A stale payload under a new question.** The data is tagged with the URL it came from and read
 *   back only for the URL in force, so changing the service or the range blanks the tiles while the
 *   new answer loads rather than leaving the old service's throughput on screen looking current.
 * - **A hidden tab.** Polling stops when the tab is not visible — these are aggregate queries over a
 *   partition-pruned range, and this app is one people leave open overnight. Coming back re-fetches
 *   at once instead of waiting out the interval, because what was left behind is now exactly as
 *   stale as the time you were away.
 */

export type Polled<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

/** What the payload is tagged with. The tag is what keeps it from lagging by one question. */
type Loaded<T> = { identity: string; data: T };

export const usePolledResource = <T>(
  url: string | null,
  pollMs: number | null,
  failureMessage: string,
  /**
   * What the payload is *about*, with any sliding edge taken out of it.
   *
   * Defaults to the URL, which is right for a resource whose URL only changes when the question
   * does. It is wrong for a window that re-anchors on a timer: `boundsFor` moves `to` every thirty
   * seconds, so the URL changes without the question changing, and reading back by URL would blank
   * the view to "reading…" twice a minute. `useHistogram` solves the same problem the same way,
   * and for the same reason — a view that flashes its loading state on a timer reads as broken.
   */
  identity: string | null = url,
): Polled<T> => {
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null);
  const [failure, setFailure] = useState<{ identity: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  /** Bumped on every teardown, and checked by every response before it writes. */
  const generation = useRef(0);

  const data = loaded && loaded.identity === identity ? loaded.data : null;
  const error = failure && failure.identity === identity ? failure.message : null;
  /* Derived rather than stored: a flag would be false for the render between the URL changing and
     the effect running, and the view would flash its empty state at a question nobody has asked
     yet. Nothing to load is not loading. */
  const loading = url !== null && data === null && error === null;

  useEffect(() => {
    if (url === null || identity === null) return;

    const generationAtStart = generation.current;
    const controller = new AbortController();

    const load = async () => {
      try {
        const response = await api(url, { signal: controller.signal });
        if (generation.current !== generationAtStart) return;

        setLoaded({ identity, data: response.data as T });
        setFailure(null);
      } catch (cause) {
        // Aborts arrive here too and are dismissed by the same check: the teardown that fired the
        // abort bumped the generation before it did so.
        if (generation.current !== generationAtStart) return;
        setFailure({ identity, message: readApiError(cause, failureMessage) });
      }
    };

    void load();

    /*
     * `null` is a resource that only re-reads when its URL changes.
     *
     * Not a very large number: `setInterval` coerces anything past 2³¹ back down to a single
     * millisecond, so the way to say "never" is to not set a timer at all.
     */
    if (pollMs === null) {
      return () => {
        generation.current += 1;
        controller.abort();
      };
    }

    const tick = () => {
      if (document.visibilityState === "visible") void load();
    };
    const id = setInterval(tick, pollMs);
    document.addEventListener("visibilitychange", tick);

    return () => {
      generation.current += 1;
      controller.abort();
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
    // `identity` changes only when `url` does — it is a coarser tag on the same question — so it
    // costs no extra fetch and lives in the closure rather than in the trigger.
  }, [url, pollMs, attempt, failureMessage]);

  const reload = useCallback(() => {
    // Cleared first, so that `loading` — which is the absence of both a payload and an error —
    // turns back on and the retry button visibly does something.
    setFailure(null);
    setAttempt((n) => n + 1);
  }, []);

  return { data, loading, error, reload };
};
