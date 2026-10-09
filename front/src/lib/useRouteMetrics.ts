"use client";

import { usePolledResource } from "@lib/usePolledResource";
import { SIGNALS_POLL_MS } from "@lib/useServiceView";
import { useSlidingBounds } from "@lib/useSlidingBounds";
import { METRICS_TEXT } from "@text/metrics";

import type { RouteDetail, RouteDetailTarget, RouteList } from "@lib/metricsTypes";
import type { RangeKey } from "@lib/timeRange";

/**
 * The two reads behind the metrics view (IKN-23), on the service tiles' clock.
 *
 * Both slide with the range every `SIGNALS_POLL_MS` and neither polls on top of that — a changed
 * URL is already a re-fetch. Both are identified by the *question* rather than the URL, so the
 * table keeps its rows while the window's right edge moves instead of blanking twice a minute.
 */

const windowQuery = (from: string, to: string) => `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

export const useRouteList = (service: string | null, range: RangeKey) => {
  const bounds = useSlidingBounds(range, SIGNALS_POLL_MS);
  const url =
    service === null ? null : `/services/${encodeURIComponent(service)}/routes?${windowQuery(bounds.from, bounds.to)}`;

  return usePolledResource<RouteList>(url, null, METRICS_TEXT.failed, service && `${service} ${range}`);
};

export const useRouteDetail = ({ service, range, route }: RouteDetailTarget) => {
  const bounds = useSlidingBounds(range, SIGNALS_POLL_MS);
  const url =
    service === null || route === null
      ? null
      : `/services/${encodeURIComponent(service)}/routes/detail?${windowQuery(bounds.from, bounds.to)}` +
        `&method=${encodeURIComponent(route.method)}&route=${encodeURIComponent(route.route)}`;

  const identity = service === null || route === null ? null : `${service} ${range} ${route.method} ${route.route}`;

  return usePolledResource<RouteDetail>(url, null, METRICS_TEXT.detailFailed, identity);
};
