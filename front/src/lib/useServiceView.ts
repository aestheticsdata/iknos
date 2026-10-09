"use client";

import { usePolledResource } from "@lib/usePolledResource";
import { useSlidingBounds } from "@lib/useSlidingBounds";
import { SERVICE_TEXT } from "@text/service";

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
 * Half the collector's cadence — it probes every 30 s and scrapes every 30 s by default since IKN-63
 * (`IKNOS_SCRAPE_INTERVAL_SECONDS`) — so the header is never more than half a reading behind.
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
 * `now` is re-taken on a timer rather than on every render — see `useSlidingBounds`.
 */
export const useServiceSignals = (service: string | null, range: RangeKey, active = true) => {
  const bounds = useSlidingBounds(range, SIGNALS_POLL_MS);
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
