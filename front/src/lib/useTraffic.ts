"use client";

import { readerTimeZone } from "@lib/trafficFormat";
import { usePolledResource } from "@lib/usePolledResource";
import { SIGNALS_POLL_MS } from "@lib/useServiceView";
import { useSlidingBounds } from "@lib/useSlidingBounds";
import { TRAFFIC_TEXT } from "@text/traffic";

import type { SiteTraffic, TrafficOverview } from "@lib/interfaces/trafficTypes";
import type { RangeKey } from "@lib/timeRange";

/**
 * The traffic view's two reads (IKN-83), on the service tiles' clock.
 *
 * Both slide with the range every `SIGNALS_POLL_MS` and are identified by the question rather than
 * the URL, like `useRouteList`, so the dashboard keeps its numbers while the window's right edge
 * moves instead of blanking twice a minute. The reader's time zone travels with each, because the
 * server counts visitors per calendar day and the day has to be the reader's.
 */

const windowQuery = (from: string, to: string) =>
  `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&tz=${encodeURIComponent(readerTimeZone())}`;

/** One site's dashboard. `null` when there is no site to read. */
export const useSiteTraffic = (service: string | null, range: RangeKey) => {
  const bounds = useSlidingBounds(range, SIGNALS_POLL_MS);
  const url =
    service === null ? null : `/services/${encodeURIComponent(service)}/traffic?${windowQuery(bounds.from, bounds.to)}`;

  return usePolledResource<SiteTraffic>(url, null, TRAFFIC_TEXT.failed, service && `${service} ${range}`);
};

/** Every site, one card each — read only while the overview is the screen. */
export const useTrafficOverview = (active: boolean, range: RangeKey) => {
  const bounds = useSlidingBounds(range, SIGNALS_POLL_MS);
  const url = active ? `/traffic?${windowQuery(bounds.from, bounds.to)}` : null;

  return usePolledResource<TrafficOverview>(
    url,
    null,
    TRAFFIC_TEXT.overviewFailed,
    active ? `overview ${range}` : null,
  );
};
