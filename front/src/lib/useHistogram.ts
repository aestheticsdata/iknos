"use client";

import { api, readApiError } from "@lib/api";
import { logHistogramUrl } from "@lib/logQuery";
import { LOGS_TEXT } from "@text/logs";
import { useCallback, useEffect, useRef, useState } from "react";

import type { LogQueryState } from "@lib/logQuery";
import type { Histogram } from "@lib/logTypes";

/**
 * The volume chart above the list. — IKN-12
 *
 * Same `LogQueryState`, same builder (IKN-12 §1) — the bars and the rows are two renderings of one
 * query, and the moment they are built from two query strings the totals stop matching the list
 * under them. That divergence is invisible while it is small and is exactly what someone counts on
 * at 3am, which is why the URL is assembled in `@lib/logQuery` and not here.
 *
 * The server chooses `bucketMs` and returns the whole range with zero-filled intervals, so this
 * hook has nothing to compute: it fetches, it tags, it hands the payload over.
 */

/** The chart, tagged with the query it draws. The tag is what keeps it from lagging by one query. */
type LoadedHistogram = { url: string; histogram: Histogram };

export type HistogramSearch = {
  histogram: Histogram | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

export const useHistogram = (state: LogQueryState): HistogramSearch => {
  const url = logHistogramUrl(state);

  const [loaded, setLoaded] = useState<LoadedHistogram | null>(null);
  const [failure, setFailure] = useState<{ url: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  /**
   * Bumped on every teardown, and checked by every response before it writes.
   *
   * Two ranges asked for in quick succession — the usual way a range is chosen, by clicking `15m`
   * and then `1h` — answer out of order often enough to matter, and the loser painting last leaves
   * a chart of the previous window with the current window's axis labels around it. It is also the
   * unmounted check: teardown bumps it, so an answer arriving after the view is gone writes
   * nothing.
   */
  const generation = useRef(0);

  /*
   * Read back only for the query in force. A changed filter set therefore blanks the chart while
   * the new one loads, rather than leaving the previous filter's bars standing over the new rows:
   * a chart that lags by one query looks every bit as authoritative as one that does not.
   */
  const histogram = loaded && loaded.url === url ? loaded.histogram : null;
  const error = failure && failure.url === url ? failure.message : null;

  /* Derived for the same reason as in `useLogSearch` — a stored flag is false for the render
   * between the query changing and the effect running, and the chart would flash its empty state
   * ("No lines in this range.") at a range that has not been asked about yet. */
  const loading = histogram === null && error === null;

  useEffect(() => {
    const generationAtStart = generation.current;
    const controller = new AbortController();

    const load = async () => {
      try {
        const response = await api(url, { signal: controller.signal });
        if (generation.current !== generationAtStart) return;

        setLoaded({ url, histogram: response.data as Histogram });
        setFailure(null);
      } catch (cause) {
        // Aborts arrive here as well and are dismissed by the same check: the teardown that fired
        // the abort bumped the generation before it did so.
        if (generation.current !== generationAtStart) return;
        setFailure({ url, message: readApiError(cause, LOGS_TEXT.histogramFailed) });
      }
    };

    void load();

    return () => {
      generation.current += 1;
      controller.abort();
    };
  }, [url, attempt]);

  const reload = useCallback(() => {
    // Cleared first, so that `loading` — which is the absence of both a chart and an error — turns
    // back on and the retry button visibly does something.
    setFailure(null);
    setAttempt((n) => n + 1);
  }, []);

  return { histogram, loading, error, reload };
};
