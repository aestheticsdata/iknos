"use client";

import { usePolledResource } from "@lib/usePolledResource";
import { useSlidingBounds } from "@lib/useSlidingBounds";
import { HOST_TEXT } from "@text/host";

import type { HostNow, HostSeries } from "@lib/interfaces/hostTypes";
import type { RangeKey } from "@lib/timeRange";

/**
 * The two reads behind the `ks-b` badge (IKN-25), on the two clocks the collector's pair uses.
 *
 * The current reading is permanent chrome — the badge's colour — so it polls, always, at the
 * sampler's own cadence: asking faster than a row is written only re-reads the same row. The
 * history is a `GROUP BY` over the range, and is asked for only while the panel is open.
 */

/** The sampler writes a `host_sample` row every 30 s; the badge is never more than one behind. */
export const HOST_POLL_MS = 30_000;

/** The badge's reading. One indexed row on the server, so polling it all day costs nothing. */
export const useHostNow = () => usePolledResource<HostNow>("/host/now", HOST_POLL_MS, HOST_TEXT.failed);

/**
 * The panel's charts, on the window the top bar is showing — fetched only while `open`.
 *
 * Gated by the URL and not by the identity, for the reason `useServiceSignals` gives: closing the
 * panel keeps the last answer readable through the 200ms exit instead of blanking the charts in
 * the first frame of it. The identity is the range alone — the right edge slides every thirty
 * seconds, and tagging by URL would flash "reading" twice a minute.
 */
export const useHostSeries = (range: RangeKey, open: boolean) => {
  const bounds = useSlidingBounds(range, HOST_POLL_MS);
  const url = open ? `/host/series?from=${encodeURIComponent(bounds.from)}&to=${encodeURIComponent(bounds.to)}` : null;

  return usePolledResource<HostSeries>(url, null, HOST_TEXT.failed, range);
};
