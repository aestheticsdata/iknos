"use client";

import { boundsFor } from "@lib/timeRange";
import { useEffect, useState } from "react";

import type { Bounds, RangeKey } from "@lib/timeRange";

/**
 * The range's bounds, re-anchored on a timer — the service tiles' clock (IKN-13), shared with the
 * metrics view (IKN-23).
 *
 * `boundsFor` is a function of the current instant, so a bare call would produce a new URL on
 * every render elsewhere on the page and re-fetch the aggregates each time. Re-anchoring every
 * `everyMs` instead slides the window's right edge at a pace the data can actually move.
 *
 * Visible tabs only, for the reason `usePolledResource` gives: the alternative is grouping a week
 * of samples every half minute for a tab nobody is looking at, all night.
 */
export const useSlidingBounds = (range: RangeKey, everyMs: number): Bounds => {
  const [anchor, setAnchor] = useState(() => new Date());

  useEffect(() => {
    const reanchor = () => {
      if (document.visibilityState === "visible") setAnchor(new Date());
    };

    const id = setInterval(reanchor, everyMs);
    document.addEventListener("visibilitychange", reanchor);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", reanchor);
    };
  }, [everyMs]);

  return boundsFor(range, anchor);
};
