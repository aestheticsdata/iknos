"use client";

import { api, readApiError } from "@lib/api";
import { buildLogQuery, logHistogramUrl } from "@lib/logQuery";
import { boundsFor } from "@lib/timeRange";
import { LOGS_TEXT } from "@text/logs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { LogQueryState } from "@lib/logQuery";
import type { Histogram } from "@lib/logTypes";
import type { Bounds, RangeKey } from "@lib/timeRange";

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
 *
 * **Except the instant the window ends at, while the tail is running.** `useLogQueryState` takes
 * `now` once and advances it only on `refresh`, which is the honest model for the list — a page of
 * rows is a snapshot, and one that reflowed under the row being read would be unusable. The chart
 * is not a page of rows. Under a live tail its last bucket stopped growing while lines went on
 * arriving above it, so the one surface whose whole job is to show volume over time was the one
 * surface that did not, and a spike happening right now was invisible until someone thought to
 * press refresh. So the chart re-anchors its own window on a timer while `live` is on and the
 * window is relative, and stands perfectly still otherwise.
 *
 * The price is that the chart's `to` runs ahead of the list's, which is the one divergence this
 * file exists to prevent — but the divergence it warns about is a *different query*, bars drawn
 * under filters the rows below were not fetched with. Here the filters are identical and only the
 * edge moves, in the same direction and for the same reason the tail moves: everything the chart
 * shows past the list's `to` is exactly what the tail is printing above it.
 */

/** The chart, tagged with the query it draws. The tag is what keeps it from lagging by one query. */
type LoadedHistogram = { identity: string; histogram: Histogram };

/**
 * How often a following chart re-anchors, from the bucket width it was last served.
 *
 * Polling faster than the granularity buys nothing a reader can see — the server picks a bucket
 * from the span (`chooseBucketMs`: 15s at `15m`, 6h at `7d`), and between two ticks inside one
 * bucket the only difference is the height of a single bar. The ceiling is what keeps a `7d` chart
 * from looking frozen for six hours, since its last bucket is filling the whole time; the floor is
 * there for the narrow windows where the server hands back one- and five-second buckets, which is
 * a cadence no chart needs and every open tab would be paying for.
 */
export const POLL_MIN_MS = 5_000;
export const POLL_MAX_MS = 60_000;

export const pollMsFor = (bucketMs: number | null): number =>
  Math.min(Math.max(bucketMs ?? POLL_MAX_MS, POLL_MIN_MS), POLL_MAX_MS);

export type HistogramSearch = {
  histogram: Histogram | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

export const useHistogram = (state: LogQueryState, range: RangeKey, live: boolean): HistogramSearch => {
  /**
   * A pinned window never slides, whatever the tail is doing.
   *
   * `?from=…&to=…` is someone being sent to an incident — the link has to keep opening on the
   * incident, and a chart that crept forward would move the very bars the sender clicked on.
   */
  const follow = live && !state.pinned;

  /** The instant this chart last re-anchored at, or `null` before it ever has. */
  const [anchor, setAnchor] = useState<Date | null>(null);

  /**
   * The later of the two clocks, and never the earlier.
   *
   * `refresh` re-takes `now` in the query state, so its `to` can be ahead of the last poll; a poll
   * is ahead of it the rest of the time. Taking the maximum means each simply wins when it is the
   * newer of the two, with no plumbing between them — and it is also what makes pausing *stop* the
   * chart rather than rewind it, since the anchor stays in force once `follow` goes false and only
   * ceases to advance.
   *
   * `boundsFor` slides both ends, so a relative range keeps its width: `15m` re-anchored is still
   * fifteen minutes, not fifteen minutes growing into twenty.
   */
  const bounds = useMemo<Bounds>(() => {
    if (state.pinned) return state.bounds;
    return boundsFor(range, new Date(Math.max(anchor?.getTime() ?? 0, Date.parse(state.bounds.to))));
  }, [state.pinned, state.bounds, range, anchor]);

  const url = logHistogramUrl({ ...state, bounds });

  /**
   * What the chart is *about*, with the sliding edge taken out of it.
   *
   * The read-back below blanks the chart whenever its tag stops matching, so tagging by the URL
   * would blank it on every re-anchor — a chart that flashes its loading state once a minute reads
   * as a chart that is broken. A relative window is therefore identified by its range key and its
   * filters: the same question, asked again a minute later, keeps the bars on screen until the new
   * ones land. A pinned window has no such identity to fall back on and keeps the URL.
   */
  const identity = useMemo(() => {
    if (state.pinned) return url;

    const params = buildLogQuery({ ...state, bounds });
    params.delete("from");
    params.delete("to");
    return `${range}?${params}`;
  }, [state, bounds, range, url]);

  const [loaded, setLoaded] = useState<LoadedHistogram | null>(null);
  const [failure, setFailure] = useState<{ identity: string; message: string } | null>(null);
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
  const histogram = loaded && loaded.identity === identity ? loaded.histogram : null;
  const error = failure && failure.identity === identity ? failure.message : null;

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

        setLoaded({ identity, histogram: response.data as Histogram });
        setFailure(null);
      } catch (cause) {
        // Aborts arrive here as well and are dismissed by the same check: the teardown that fired
        // the abort bumped the generation before it did so.
        if (generation.current !== generationAtStart) return;
        setFailure({ identity, message: readApiError(cause, LOGS_TEXT.histogramFailed) });
      }
    };

    void load();

    return () => {
      generation.current += 1;
      controller.abort();
    };
    // `identity` changes only when `url` does, so it costs no extra fetch — it is in the closure
    // rather than in the trigger.
  }, [url, identity, attempt]);

  /**
   * The re-anchor timer, and the only thing in this file that runs without being asked.
   *
   * Hidden tabs are skipped rather than polled: this is a `GROUP BY` over a partition-pruned week
   * that nobody is looking at, once a minute, for as long as the tab stays open — which for this
   * app means overnight. Returning to the tab re-anchors immediately instead of waiting out the
   * interval, since the chart that was left behind is now as stale as the time you were away.
   */
  const pollMs = pollMsFor(histogram?.bucketMs ?? null);

  useEffect(() => {
    if (!follow) return;

    const reanchor = () => {
      if (document.visibilityState === "visible") setAnchor(new Date());
    };

    const id = setInterval(reanchor, pollMs);
    document.addEventListener("visibilitychange", reanchor);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", reanchor);
    };
  }, [follow, pollMs]);

  const reload = useCallback(() => {
    // Cleared first, so that `loading` — which is the absence of both a chart and an error — turns
    // back on and the retry button visibly does something.
    setFailure(null);
    setAttempt((n) => n + 1);
  }, []);

  return { histogram, loading, error, reload };
};
