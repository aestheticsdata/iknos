"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * What the view tells the status bar (IKN-22 §3).
 *
 * The bar lives in the chassis and the numbers live in the view, which is the same split the
 * keyboard has and it is resolved the same way: the view publishes, the chrome reads. The
 * alternative — hoisting the log query into the chassis so the bar can see it — would put the
 * whole of IKN-12's state one level above the only component that uses it, to render three cells.
 *
 * **`null` means the cell has nothing to say and is not drawn.** A page with no log list publishes
 * nothing, and the bar shows what it can fill honestly rather than `0 ev · q 0ms`, which reads as
 * a query that returned nothing rather than as a page that never ran one.
 */
export type ViewStatus = {
  /** Whether the live tail is running. `null` on a page that has no tail. */
  live: boolean | null;
  /** Rows currently on screen for the range. */
  count: number | null;
  /** The last query's server-measured time — `meta.tookMs`, IKN-19. */
  tookMs: number | null;
};

const EMPTY: ViewStatus = { live: null, count: null, tookMs: null };

const StatusContext = createContext<ViewStatus>(EMPTY);
const PublishContext = createContext<((status: ViewStatus) => void) | null>(null);

export const ViewStatusProvider = ({ children }: { children: React.ReactNode }) => {
  const [status, setStatus] = useState<ViewStatus>(EMPTY);

  const publish = useCallback((next: ViewStatus) => {
    // Compared field by field before storing. The publisher hands over a fresh object on every
    // render of the view, and storing it unconditionally would re-render the whole chassis on
    // every keystroke in the query bar — for three numbers that had not changed.
    setStatus((current) =>
      current.live === next.live && current.count === next.count && current.tookMs === next.tookMs ? current : next,
    );
  }, []);

  return (
    <PublishContext.Provider value={publish}>
      <StatusContext.Provider value={status}>{children}</StatusContext.Provider>
    </PublishContext.Provider>
  );
};

/**
 * Publish this view's numbers for as long as it is mounted, and clear them when it goes.
 *
 * Clearing on unmount is what keeps the bar honest across a navigation: a count left standing from
 * the logs view would sit under a page that has no rows at all.
 */
export const usePublishViewStatus = (status: ViewStatus): void => {
  const publish = useContext(PublishContext);
  const { live, count, tookMs } = status;

  useEffect(() => {
    if (publish === null) return;
    publish({ live, count, tookMs });
    return () => publish(EMPTY);
  }, [publish, live, count, tookMs]);
};

export const useViewStatus = (): ViewStatus => useContext(StatusContext);

/** Stable identity, so a caller may pass it straight through without a `useMemo`. */
export const useNoViewStatus = (): ViewStatus => useMemo(() => EMPTY, []);
