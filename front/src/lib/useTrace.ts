"use client";

import { api, readApiError } from "@lib/api";
import { logTraceUrl } from "@lib/logQuery";
import { LOGS_TEXT } from "@text/logs";
import { useCallback, useEffect, useState } from "react";

import type { LogQueryState } from "@lib/logQuery";
import type { Trace } from "@lib/logTypes";

/**
 * One trace, fetched when a `traceId` is opened — IKN-12 §4.
 *
 * Separate from `useLogSearch` rather than folded into it because the two answer different
 * questions with different lifetimes: the list is the current filter set, the trace is one id the
 * user pointed at, and it outlives a filter change (you open a trace, then widen the range to see
 * more of it, and the modal must not vanish underneath you).
 *
 * The window still comes from the shared state: `/api/logs/trace/:id` is bounded like every other
 * route, because `(trace_id, ts)` is indexed but an id that appears nowhere still walks that index
 * across every partition otherwise.
 */
export const useTrace = (
  traceId: string | null,
  state: LogQueryState,
): { trace: Trace | null; loading: boolean; error: string | null } => {
  const [trace, setTrace] = useState<Trace | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (id: string, signal: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const response = await api(logTraceUrl(id, state), { signal });
        setTrace(response.data as Trace);
      } catch (failure) {
        // An aborted request is this effect being torn down, not a failure to report: showing
        // "could not load" because the user closed the modal would be a lie on the way out.
        if (signal.aborted) return;
        setError(readApiError(failure, LOGS_TEXT.traceFailed));
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [state],
  );

  useEffect(() => {
    if (!traceId) {
      setTrace(null);
      setError(null);
      return;
    }

    const controller = new AbortController();
    void load(traceId, controller.signal);
    return () => controller.abort();
  }, [traceId, load]);

  return { trace, loading, error };
};
