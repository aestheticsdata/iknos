"use client";

import { api, readApiError } from "@lib/api";
import { logSearchUrl } from "@lib/logQuery";
import { LOGS_TEXT } from "@text/logs";
import { useCallback, useEffect, useRef, useState } from "react";

import type { LogQueryState } from "@lib/logQuery";
import type { LogPage, LogRow } from "@lib/logTypes";

/**
 * The rows under the histogram — page one, and every page appended after it. — IKN-12
 *
 * The URL is built by `logSearchUrl` and by nothing else (IKN-12 §1). Not tidiness: the list, the
 * bars above it and the tail beside it have to be describing the same set of lines, and three
 * hooks each assembling their own query string agree exactly until one of them is edited.
 *
 * **Keyset pagination, never LIMIT/OFFSET.** The cursor encodes `(ts, id)` and rows arrive
 * newest-first, so a page boundary is a fact about two rows rather than a count of rows the server
 * had to skip. That is what makes appending safe while ingestion is running: lines committed since
 * page one sort *above* everything already fetched and cannot move the boundary. `OFFSET 100` under
 * the same conditions re-serves rows that are already on screen and skips the ones they pushed
 * down — duplicates and holes, neither of which the reader has any way to notice.
 */

/**
 * One screenful of the dense table, plus a scroll in hand.
 *
 * Large enough that arriving at the bottom of the viewport does not immediately demand another
 * round trip — the request nobody wants to wait on is the one that fires while they are still
 * reading — and small enough that the first page of a busy hour is one fast query rather than a
 * megabyte of messages, most of which will be scrolled past.
 */
export const PAGE_SIZE = 100;

/** A stable identity for "no rows", so a consumer may safely put `rows` in a dependency list. */
const NO_ROWS: LogRow[] = [];

/** A page set, tagged with the query it answers. The tag is the whole point — see `useLogSearch`. */
type LoadedPages = {
  url: string;
  rows: LogRow[];
  cursor: string | null;
  tookMs: number;
};

export type LogSearch = {
  rows: LogRow[];
  /** The last query's server-side time, for the status bar's `q 38ms`. */
  tookMs: number | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
};

/**
 * `"before"` is every consumer this hook had until IKN-59 — the search page under the histogram,
 * paging toward older rows. `"after"` is the newer-chain a jump anchors: the same hook, walking the
 * opposite way from the same `state.anchor`, so the two chains cannot drift into two different
 * ideas of what query they are paging.
 *
 * The `"after"` chain is meaningless without an anchor to page away from — the range buttons and
 * bucket clicks land their first page at `to` already, with nothing newer inside `[from, to)` left
 * to fetch — so a hook called with `dir: "after"` and no `state.anchor` simply never fetches
 * (`enabled` below), rather than the caller having to remember not to render it.
 */
export const useLogSearch = (state: LogQueryState, dir: "before" | "after" = "before"): LogSearch => {
  const enabled = dir === "before" || state.anchor !== null;

  /*
   * The entire query, as one string, and therefore the identity of the search: the dependency the
   * effect watches and the tag every result carries. Two `LogQueryState` objects that build the
   * same URL *are* the same search, whereas comparing the objects themselves would refetch on
   * every render that happened to rebuild one.
   */
  const url = logSearchUrl(state, { limit: PAGE_SIZE, dir });

  const [pages, setPages] = useState<LoadedPages | null>(null);
  const [failure, setFailure] = useState<{ url: string; message: string } | null>(null);
  const [appending, setAppending] = useState(false);
  const [attempt, setAttempt] = useState(0);

  /**
   * Bumped on every teardown — a query change, a reload, an unmount.
   *
   * Each response checks it before touching state, and it is the guard against the one hazard
   * keyset pagination cannot cover by itself: a slow answer for the *previous* filter set landing
   * after the new one has painted. Unguarded, those rows would replace the current list while the
   * cursor stored beside them came from a different query, and the next `loadMore` would append
   * that query's page two underneath — the duplicates and skips the ticket grades, arrived by the
   * back door. It doubles as the unmounted check: teardown bumps it, so nothing in flight can set
   * state on a component that is gone.
   */
  const generation = useRef(0);

  /** One controller per generation, so a superseded query stops holding a connection open. */
  const inFlight = useRef<AbortController | null>(null);

  /*
   * Results are read back only for the query in force. A render that changed the filters therefore
   * shows an empty, loading list rather than the previous filter's rows, and pages from two filter
   * sets are not merely prevented from merging — the state cannot express it.
   */
  const current = pages && pages.url === url ? pages : null;
  const error = failure && failure.url === url ? failure.message : null;

  /*
   * Derived, not stored. A `loading` boolean owned by the effect is false for the render between
   * the query changing and the effect running, and in that frame the table would say "No lines
   * match these filters in this range." to someone who has just typed one.
   *
   * `enabled &&`: the `"after"` chain with no anchor is not "loading" — it has nothing to load
   * and never will while it stays disabled, which is a different fact from "the request is in
   * flight" and must not render the same spinner.
   */
  const loading = enabled && current === null && error === null;

  useEffect(() => {
    if (!enabled) return;

    const generationAtStart = generation.current;
    const controller = new AbortController();
    inFlight.current = controller;
    setAppending(false);

    const load = async () => {
      try {
        const response = await api(url, { signal: controller.signal });
        if (generation.current !== generationAtStart) return;

        const page = response.data as LogPage;
        setPages({ url, rows: page.rows, cursor: page.nextCursor, tookMs: page.meta.tookMs });
        setFailure(null);
      } catch (cause) {
        // An abort lands here too, and leaves through the same door: the teardown that aborted it
        // bumped the generation first, so the check above has already dismissed it.
        if (generation.current !== generationAtStart) return;

        // The API's own message names the parameter it rejected, which on a shared link carrying a
        // hand-edited window is the whole diagnosis. The copy is the fallback, not the default.
        setFailure({ url, message: readApiError(cause, LOGS_TEXT.searchFailed) });
      }
    };

    void load();

    return () => {
      generation.current += 1;
      controller.abort();
    };
  }, [url, attempt, enabled]);

  const loadMore = useCallback(() => {
    const from = pages && pages.url === url ? pages : null;
    if (!enabled || !from?.cursor || appending) return;

    const generationAtStart = generation.current;
    setAppending(true);

    const append = async () => {
      try {
        // The cursor is opaque and the only contract with it is to hand it back — `logSearchUrl`
        // takes it precisely so that a page two is the same query plus a position, and never a
        // second query assembled somewhere else.
        const response = await api(logSearchUrl(state, { cursor: from.cursor, limit: PAGE_SIZE, dir }), {
          signal: inFlight.current?.signal,
        });
        if (generation.current !== generationAtStart) return;

        const page = response.data as LogPage;
        setPages((existing) =>
          // The tag is re-checked inside the updater as well. The generation guard above already
          // covers the ordering hazard; this covers the shape of the write itself, so that no path
          // through this file can append one filter set's rows to another's.
          existing && existing.url === url
            ? {
                url,
                // Both chains keep `rows` newest-first, and each one arrives from `page.rows`
                // already in that order — but the *new* page sits on a different side depending on
                // which way it was fetched. Paging `"before"` walks toward older rows than
                // anything already held, which belong after them; paging `"after"` walks toward
                // newer rows than anything already held, which belong before them. Appending on
                // both, the shape `"before"` already had, would leave an `"after"` chain reading
                // its own history backwards the moment a second page landed.
                rows: dir === "before" ? [...existing.rows, ...page.rows] : [...page.rows, ...existing.rows],
                cursor: page.nextCursor,
                // The status bar reports the query you last made. Keeping page one's number after
                // five appends would show a timing that measured nothing on screen.
                tookMs: page.meta.tookMs,
              }
            : existing,
        );
        setFailure(null);
      } catch (cause) {
        if (generation.current !== generationAtStart) return;
        // The cursor is left untouched, so the failed page can simply be asked for again — a failed
        // append must not be able to end a list that has not ended.
        setFailure({ url, message: readApiError(cause, LOGS_TEXT.searchFailed) });
      } finally {
        if (generation.current === generationAtStart) setAppending(false);
      }
    };

    void append();
  }, [pages, url, state, appending, enabled, dir]);

  const reload = useCallback(() => {
    // The failure is cleared first so the retry is visible: `loading` is derived from having
    // neither a page nor an error for this query, so leaving the old error standing would run the
    // refetch silently behind an unchanged error message.
    setFailure(null);
    setAttempt((n) => n + 1);
  }, []);

  return {
    rows: current?.rows ?? NO_ROWS,
    tookMs: current?.tookMs ?? null,
    loading,
    // Guarded by the tag as well: the flag is reset by the effect, and until that effect runs a
    // changed query would otherwise render "loading…" beneath a list that is already empty.
    loadingMore: appending && current !== null,
    error,
    hasMore: Boolean(current?.cursor),
    loadMore,
    reload,
  };
};
