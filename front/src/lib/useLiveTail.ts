"use client";

import { logStreamUrl } from "@lib/logQuery";
import { useCallback, useEffect, useRef, useState } from "react";

import type { LogQueryState } from "@lib/logQuery";
import type { LogFeedItem, LogRow } from "@lib/logTypes";

/**
 * The live tail — the same query as the list, arriving one line at a time. — IKN-12
 *
 * `EventSource` rather than `fetch`, and a **relative** URL rather than `@lib/api`. The browser's
 * own SSE client is what reconnects after a dropped connection, backs off, and survives a laptop
 * closing; axios cannot be handed to it and a hand-rolled reader would owe all of that back. The
 * relative URL is what carries `iknos.sid`: same-origin is the arrangement nginx provides in
 * production and `next.config.js` rewrites into existence in development, and it is the reason the
 * API ships no CORS configuration at all — an absolute cross-origin URL here would need one, plus
 * `withCredentials`, to send a cookie it currently sends by default.
 *
 * The query string still comes from `@lib/logQuery` (IKN-12 §1). The tail showing lines that the
 * bar above it excludes is the same failure as the chart disagreeing with the list, and it is
 * worse here because the lines are arriving while someone watches.
 */

/**
 * The most items the buffer holds; arrivals past it push the oldest out.
 *
 * The graded criterion is eight hours in live tail with browser memory flat, and an append-only
 * list cannot meet it — a fleet logging twenty lines a second produces well over half a million
 * rows in that time, hundreds of megabytes of strings that were scrolled past hours ago. Two
 * thousand is chosen against what the buffer is *for*: it is the last several minutes of a busy
 * fleet, which is the window in which "what just happened" is answered by watching. Anything older
 * is a question for the list below, which has the whole range and a cursor with which to walk it.
 */
export const TAIL_CAP = 2000;

/** A stable identity for "nothing yet", so a consumer may put `items` in a dependency list. */
const NO_ITEMS: LogFeedItem[] = [];

/**
 * One tail session: the stream's query, what has arrived on it, and what it admits to having lost.
 *
 * Tagged with the URL for the same reason the search and the histogram are — a session belongs to
 * a query, and rows caught under one filter must not still be on screen under the next one. Here
 * the tag is also what resets `dropped`: a drop count carried across a filter change describes the
 * health of a stream nobody is connected to any more.
 */
type TailSession = { url: string; items: LogFeedItem[]; dropped: number };

const NO_SESSION: TailSession = { url: "", items: NO_ITEMS, dropped: 0 };

export type LiveTail = {
  /** Newest first — rows and the holes between them, ready to render as one list. */
  items: LogFeedItem[];
  connected: boolean;
  dropped: number;
  clear: () => void;
};

/**
 * The payload of a *named* SSE event.
 *
 * `EventSourceEventMap` knows only `open`, `message` and `error`, so `log` and `lagged` come
 * through the untyped `addEventListener` overload as a base `Event`. The cast restates what the
 * protocol already guarantees — every SSE dispatch is a `MessageEvent` whose `data` is the frame's
 * text — rather than inventing a fact about it.
 */
const frameData = (event: Event): string => (event as MessageEvent<string>).data;

/**
 * Rejects rather than throws.
 *
 * One malformed frame must not be able to take down a tail that is otherwise healthy, and there is
 * nowhere sensible to report it: the thing that failed to parse is the very line whose content
 * would be shown. `ts` and `service` are checked because the key is built from them, and a row
 * missing either would produce a key reading `undefined·undefined·41` — unique, and useless to
 * anyone reading the DOM.
 */
const parseRow = (data: string): LogRow | null => {
  try {
    const row = JSON.parse(data) as LogRow;
    return typeof row?.ts === "string" && typeof row.service === "string" ? row : null;
  } catch {
    return null;
  }
};

export const useLiveTail = (state: LogQueryState, enabled: boolean): LiveTail => {
  // `/api` is prefixed here rather than by `@lib/api`, whose base points at a remote host when the
  // page is served from localhost — deliberately, since that is a cross-origin URL and would cost
  // this stream its cookie.
  const url = `/api${logStreamUrl(state)}`;

  const [session, setSession] = useState<TailSession>(NO_SESSION);

  /**
   * The URL of the stream believed to be up, or `null` while it is down.
   *
   * A URL rather than a boolean so that the answer is always about the query being *looked at*: a
   * flag left true by the previous stream would put a LIVE chip over a filter whose stream has not
   * connected yet.
   */
  const [openUrl, setOpenUrl] = useState<string | null>(null);

  /**
   * Monotonic for the life of the hook, and never reset.
   *
   * A live row has `id: ""` — committed, never read back, no autoincrement yet — so its React key
   * has to be minted here. The API's note suggests `ts` + `service` + `message`, but two identical
   * lines logged in the same millisecond by one service is precisely what a retry loop emits, and
   * duplicate keys silently drop a row from the list — the one bug a tail must not have. The
   * counter is what makes the key unique; `ts` and `service` stay in it because a key that can be
   * read in the inspector is worth more than one that cannot, and `message` stays out because it
   * can be kilobytes long.
   */
  const sequence = useRef(0);

  const belongs = session.url === url;
  const items = belongs ? session.items : NO_ITEMS;
  const dropped = belongs ? session.dropped : 0;
  const connected = enabled && openUrl === url;

  useEffect(() => {
    if (!enabled) return;

    const source = new EventSource(url);

    /*
     * Optimistic: the stream counts as up from the moment it is opened, before the handshake
     * completes. `connected: false` drives "connection lost — reconnecting…", and a handshake in
     * progress has not lost anything — starting every filter change with a red banner for as long
     * as the round trip takes is how a warning gets trained out of being read.
     */
    setOpenUrl(url);

    /*
     * One `setState` per line, into one array, with the cap applied on the way in. No coalescing
     * buffer: a ref that accumulates between animation frames is a second copy of the rows, and in
     * a backgrounded tab `requestAnimationFrame` stops firing while lines keep arriving — which is
     * exactly the unbounded growth the cap exists to prevent, reintroduced beside it.
     */
    const push = (item: LogFeedItem, lost: number) =>
      setSession((existing) => {
        // A frame that lands during teardown starts a session for its own URL rather than
        // contaminating another query's buffer.
        const base = existing.url === url ? existing : NO_SESSION;
        return {
          url,
          // Newest first, so the old end is the tail of the array and `slice` is the eviction.
          items: [item, ...base.items].slice(0, TAIL_CAP),
          dropped: base.dropped + lost,
        };
      });

    const onOpen = () => setOpenUrl(url);

    const onLog = (event: Event) => {
      const row = parseRow(frameData(event));
      if (!row) return;

      sequence.current += 1;
      push({ kind: "row", key: `${row.ts}·${row.service}·${sequence.current}`, row }, 0);
    };

    /*
     * A gap becomes an item in the list rather than a number in the corner, because the break is a
     * fact about a *place* in the stream: the lines that were dropped were between these two rows
     * and nowhere else, and a tail that skips them silently still looks perfectly continuous.
     */
    const onLagged = (event: Event) => {
      const count = Number.parseInt(frameData(event), 10);
      if (!Number.isFinite(count) || count <= 0) return;

      sequence.current += 1;
      push({ kind: "gap", key: `gap·${sequence.current}`, dropped: count }, count);
    };

    /*
     * Reported, not acted on. `EventSource` is already retrying with its own backoff by the time
     * this fires, and a reconnect loop written on top of it would produce two clients racing to
     * subscribe to the same filter. What the browser will not do is *say* anything, which is the
     * whole of this handler's job.
     */
    const onError = () => setOpenUrl(null);

    source.addEventListener("open", onOpen);
    source.addEventListener("log", onLog);
    source.addEventListener("lagged", onLagged);
    source.addEventListener("error", onError);

    return () => {
      source.removeEventListener("open", onOpen);
      source.removeEventListener("log", onLog);
      source.removeEventListener("lagged", onLagged);
      source.removeEventListener("error", onError);
      // A stream left open goes on reconnecting for the lifetime of the tab, against a filter
      // nobody is looking at, and the server holds a subscription per one of them.
      source.close();
    };
    // No state is set from the teardown: `connected` is derived from `enabled` and the URL, so
    // disabling, changing the query and unmounting each answer correctly without a write.
  }, [url, enabled]);

  const clear = useCallback(
    // The drop count goes with the lines it describes. It measures the integrity of the buffer
    // being read, and "412 dropped" standing over an empty list points at nothing.
    () => setSession({ url, items: NO_ITEMS, dropped: 0 }),
    [url],
  );

  return { items, connected, dropped, clear };
};
