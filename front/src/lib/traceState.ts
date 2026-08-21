"use client";

import { parseAsString, useQueryState } from "nuqs";
import { useCallback } from "react";

/**
 * Which trace is open, in the URL (IKN-22).
 *
 * It was component state on the log panel, which was right while the only way to open a timeline
 * was clicking a row in that panel. The ⌘K palette opens one from the chassis, and hoisting the
 * panel's state up to the chrome to reach it would put IKN-12's internals one level above the only
 * component that uses them.
 *
 * The URL is the seam both already share, and it pays for itself twice: a trace becomes a link.
 * Sending someone `?trace=9ab30f71` is the single most useful thing one person debugging can hand
 * another, and it costs nothing to have.
 *
 * `history: "replace"`, so stepping through four traces does not leave four entries the back
 * button has to walk out of — closing one returns to the list, which is what back means here.
 */
export const useTraceParam = (): [string | null, (traceId: string | null) => void] => {
  const [traceId, setTraceId] = useQueryState("trace", parseAsString.withOptions({ history: "replace" }));

  const set = useCallback(
    (next: string | null) => {
      void setTraceId(next);
    },
    [setTraceId],
  );

  return [traceId, set];
};

/** The write half alone, for callers that only ever open one. */
export const useOpenTrace = (): ((traceId: string | null) => void) => useTraceParam()[1];
