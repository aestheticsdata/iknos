"use client";

import { logIpGroupsUrl } from "@lib/logQuery";
import { usePolledResource } from "@lib/usePolledResource";
import { LOGS_TEXT } from "@text/logs";
import { parseAsBoolean, useQueryState } from "nuqs";

import type { IpGroups } from "@lib/interfaces/ipGroupTypes";
import type { LogQueryState } from "@lib/logQuery";

/**
 * Whether the grouping panel is open — `?ips=true`, in the URL with the rest of the view (IKN-72).
 *
 * A link to "these filters, grouped by address" is the thing worth handing someone when a scan is
 * the subject, and it should reopen showing the counts rather than the rows they summarise.
 */
export const useIpGroupsOpen = () => useQueryState("ips", parseAsBoolean.withDefault(false));

/**
 * Hits per address, under the very query the list is showing — fetched only while `open`.
 *
 * The URL comes from `@lib/logQuery` like the list's, the histogram's and the tail's, so the counts
 * are counts of the rows underneath and an `ip` token narrows them to its one address. Not polled:
 * like the list, it is a snapshot of the range, re-read when the query changes or on refresh.
 *
 * Gated by the URL and not by the identity, as `useHostSeries` is: closing the panel keeps the last
 * answer on screen through the fold's exit instead of blanking it in the first frame.
 */
export const useIpGroups = (state: LogQueryState, open: boolean) => {
  const url = logIpGroupsUrl(state);
  return usePolledResource<IpGroups>(open ? url : null, null, LOGS_TEXT.ipGroupsFailed, url);
};
