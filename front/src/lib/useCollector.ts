"use client";

import { api } from "@lib/api";
import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState } from "react";

import type { CollectorStatus, CollectorStorage } from "@lib/collectorTypes";

/**
 * Iknos watching itself, from the browser — IKN-24.
 *
 * Two hooks with deliberately different rhythms. The status is permanent chrome and polls; the
 * storage reading is behind a panel and is fetched when that panel opens, because a number that
 * moves over days has no business being refreshed while nobody is looking at it.
 */

/**
 * How often the pastille asks.
 *
 * The route reads counters out of the collector's memory and never touches MySQL, so this is
 * close to free — but it is open in every tab, all day, and ten seconds is already fast enough to
 * turn the pastille red inside the minute the ticket asks for.
 */
export const STATUS_POLL_MS = 10_000;

/**
 * How often the pastille re-reads its *own* clock, between polls.
 *
 * Without this the pill would only ever change colour when an answer arrived — so an API that has
 * stopped answering at all, which is the most complete kind of outage there is, would leave a
 * green dot on screen indefinitely. Ageing locally is what makes silence visible.
 */
const TICK_MS = 5_000;

export type CollectorStatusState = {
  status: CollectorStatus | null;
  /** Browser clock when `status` arrived — half of the skew-free ageing in `ageOfPoll`. */
  receivedAt: number;
  /** Browser clock, advanced on a timer so the view ages between answers. */
  now: number;
};

/**
 * One poll for the whole chassis.
 *
 * The pastille and the ingest card read the same snapshot, and they must read the *same* one: two
 * hooks polling independently would drift a few seconds apart, so a dot reporting the collector
 * dead could sit above a card still drawing the throughput from before it died. Which of those to
 * believe is not a question the interface should be asking anyone.
 */
const CollectorContext = createContext<CollectorStatusState | null>(null);

export const CollectorProvider = ({ children }: { children: React.ReactNode }) =>
  // `createElement` rather than JSX because this file is `.ts` — the hooks belong beside the types
  // they return, and one provider is not worth splitting the module for.
  createElement(CollectorContext.Provider, { value: usePolledStatus() }, children);

/**
 * The shared reading. Falls back to the neutral state outside a provider rather than throwing:
 * the auth screens render chassis primitives without the chassis around them, and a pastille that
 * says "starting" there is correct — nothing has told it otherwise.
 */
export const useCollectorStatus = (): CollectorStatusState =>
  useContext(CollectorContext) ?? { status: null, receivedAt: 0, now: 0 };

const usePolledStatus = (): CollectorStatusState => {
  const [state, setState] = useState<{ status: CollectorStatus | null; receivedAt: number }>({
    status: null,
    receivedAt: 0,
  });
  /*
   * Starts at 0 rather than at `Date.now()`: the server and the browser do not agree on the time,
   * and a value read during render is a hydration mismatch on every page load. Nothing is drawn
   * from it until the first effect has run, and until then the pastille is in its neutral state —
   * which is the truthful thing to show before any answer has arrived anyway.
   */
  const [now, setNow] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const generationAtStart = generation.current;
    const controller = new AbortController();

    const load = async () => {
      try {
        const response = await api("/collector/status", { signal: controller.signal });
        if (generation.current !== generationAtStart) return;
        setState({ status: response.data as CollectorStatus, receivedAt: Date.now() });
      } catch {
        /*
         * Deliberately silent, and deliberately keeping the previous answer.
         *
         * There is nowhere to put an error here — this is a six-pixel dot in a permanent bar, and
         * a failed poll is not a thing to interrupt anyone about. Holding the last status is not
         * hiding the failure either: it goes on ageing against the local clock, so an API that has
         * stopped answering turns the pastille red on its own within the minute. That is a truer
         * report than an error badge, because an unreachable API *is* a collector nobody can
         * confirm is running — the two live in the same process.
         */
      }
    };

    const poll = () => {
      // A backgrounded tab is left alone. This app is open overnight, and polling a dot nobody can
      // see is the definition of a request not worth making.
      if (document.visibilityState === "visible") void load();
    };

    void load();
    const pollId = setInterval(poll, STATUS_POLL_MS);
    // Returning to the tab asks immediately: whatever is on screen is as stale as the time away.
    document.addEventListener("visibilitychange", poll);

    const tick = () => setNow(Date.now());
    tick();
    const tickId = setInterval(tick, TICK_MS);

    return () => {
      generation.current += 1;
      controller.abort();
      clearInterval(pollId);
      clearInterval(tickId);
      document.removeEventListener("visibilitychange", poll);
    };
  }, []);

  return { status: state.status, receivedAt: state.receivedAt, now };
};

export type StorageState = {
  storage: CollectorStorage | null;
  loading: boolean;
  failed: boolean;
  reload: () => void;
};

/**
 * The storage reading, fetched only while `open`.
 *
 * `information_schema` over a partitioned table is the one genuinely expensive thing either of
 * these routes does. The API caches it for minutes, and this side simply does not ask until
 * somebody has opened the panel — between them, the log queries never wait behind it.
 */
export const useCollectorStorage = (open: boolean): StorageState => {
  const [storage, setStorage] = useState<CollectorStorage | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    if (!open) return;

    const generationAtStart = generation.current;
    const controller = new AbortController();

    const load = async () => {
      try {
        const response = await api("/collector/storage", { signal: controller.signal });
        if (generation.current !== generationAtStart) return;
        setStorage(response.data as CollectorStorage);
        setFailed(false);
      } catch {
        if (generation.current !== generationAtStart) return;
        setFailed(true);
      }
    };

    void load();

    return () => {
      generation.current += 1;
      controller.abort();
    };
  }, [open, attempt]);

  const reload = useCallback(() => {
    setFailed(false);
    setAttempt((n) => n + 1);
  }, []);

  // Loading is the absence of both, derived rather than stored — a stored flag is false for the
  // render between opening the panel and the effect running, and the panel would flash its error.
  return { storage, loading: storage === null && !failed, failed, reload };
};
