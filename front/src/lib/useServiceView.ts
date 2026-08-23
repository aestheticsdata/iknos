"use client";

import { boundsFor } from "@lib/timeRange";
import { usePolledResource } from "@lib/usePolledResource";
import { SERVICE_TEXT } from "@text/service";
import { useEffect, useState } from "react";

import type { ServiceRuntime, ServiceSignals } from "@lib/serviceTypes";
import type { RangeKey } from "@lib/timeRange";

/**
 * The two reads behind the service view (IKN-13).
 *
 * They are separate hooks against separate routes because they answer different questions on
 * different clocks. The runtime is a snapshot of the process — the range selector has nothing to
 * say about it — and it is polled at the collector's own scrape cadence, so the header is never
 * more than one scrape behind what the box is doing. The signals are three aggregates over the
 * selected window, and re-running them every fifteen seconds would be paying for a chart whose
 * narrowest interval is a minute wide.
 */

/**
 * The collector scrapes every 15 s and probes every 30 s, so this is the fastest cadence at which
 * there is ever anything new to see. Faster would be the same numbers, more often.
 */
export const RUNTIME_POLL_MS = 15_000;

/**
 * Half the narrowest interval the signals are ever bucketed into (`MIN_METRIC_BUCKET_MS` is a
 * minute), which is enough for the trailing bar to fill visibly without asking MySQL to group a
 * week's samples twice a minute.
 */
export const SIGNALS_POLL_MS = 30_000;

export const useServiceRuntime = (service: string | null) =>
  usePolledResource<ServiceRuntime>(
    service === null ? null : `/services/${encodeURIComponent(service)}/runtime`,
    RUNTIME_POLL_MS,
    SERVICE_TEXT.failed,
  );

/**
 * The signals, on the window the top bar is showing.
 *
 * **The range, never the log panel's pinned window.** The panel below can be pinned to a single
 * histogram bucket by clicking it, which is a gesture about the log list; the tiles answer the
 * range the reader chose, which is the state §5.2 says is shared across views. Following the pin
 * would mean clicking a bar in the log chart silently re-scoped the four tiles above it, and there
 * is nothing on screen that would say so.
 *
 * `now` is re-taken on a timer rather than on every render: `boundsFor` is a function of the
 * current instant, so a bare call would produce a new URL on every keystroke elsewhere on the page
 * and re-fetch three aggregates each time.
 */
export const useServiceSignals = (service: string | null, range: RangeKey, active = true) => {
  const [anchor, setAnchor] = useState(() => new Date());

  useEffect(() => {
    // Visible tabs only, for the reason `usePolledResource` gives: the alternative is grouping a
    // week of samples every half minute for a tab nobody is looking at, all night.
    const reanchor = () => {
      if (document.visibilityState === "visible") setAnchor(new Date());
    };

    const id = setInterval(reanchor, SIGNALS_POLL_MS);
    document.addEventListener("visibilitychange", reanchor);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", reanchor);
    };
  }, []);

  const bounds = boundsFor(range, anchor);
  /*
   * `active` is the tiles being on screen — collapsed, there is nothing to pay three aggregates
   * for. It gates the *URL* and deliberately not the identity below: the payload is still about
   * this service over this range, so the last one read stays readable and the row keeps its numbers
   * while it folds away. Gating both would blank the tiles in the first frame of a 150ms collapse,
   * which is the animation showing its own machinery.
   */
  const url =
    service === null || !active
      ? null
      : `/services/${encodeURIComponent(service)}/signals?from=${encodeURIComponent(bounds.from)}&to=${encodeURIComponent(bounds.to)}`;

  /*
   * No polling of its own: the URL already changes every time the anchor moves, and a changed URL
   * re-fetches. A second timer on top would double the work and, worse, would keep re-asking a
   * window whose right edge had stopped moving.
   *
   * The identity is the *question* — this service over this range — rather than the URL, whose
   * right edge slides every thirty seconds. Tagged by URL, the tiles would blank to "reading…"
   * twice a minute for a chart whose subject had not changed.
   */
  return usePolledResource<ServiceSignals>(url, null, SERVICE_TEXT.failed, service && `${service} ${range}`);
};
