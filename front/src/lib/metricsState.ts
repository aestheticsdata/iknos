"use client";

import { parseAsString, useQueryState } from "nuqs";

import type { RouteKey } from "@lib/metricsTypes";

/**
 * Which route the metrics view has open (IKN-23), in the URL like every other piece of view state.
 *
 * **`endpoint`, not `route`.** `route` is the log list's filter, and the rail carries the whole
 * query string across views (`ServiceRail`'s `withScope`) — selecting `GET /api/x` here and then
 * clicking `logs` in the rail would arrive with a route filter of `GET /api/x`, which matches no
 * line. Same collision `issueState.ts` dodged with `seg`.
 *
 * One string, `METHOD path`: the method never contains a space, so the first one is the seam.
 * `history: "replace"`, like `?issue=` — walking down the table should not leave one back-button
 * entry per row.
 */

export const routeParam = (key: RouteKey): string => `${key.method} ${key.route}`;

/** The pair back out of the parameter, or `null` for anything that does not have both halves. */
export const parseRouteParam = (value: string | null): RouteKey | null => {
  if (value === null) return null;

  const seam = value.indexOf(" ");
  if (seam <= 0 || seam === value.length - 1) return null;

  return { method: value.slice(0, seam), route: value.slice(seam + 1) };
};

export const sameRoute = (a: RouteKey | null, b: RouteKey | null): boolean =>
  a !== null && b !== null && a.method === b.method && a.route === b.route;

export const useSelectedRoute = (): [RouteKey | null, (next: RouteKey | null) => void] => {
  const [value, setValue] = useQueryState("endpoint", parseAsString.withOptions({ history: "replace" }));

  const select = (next: RouteKey | null) => {
    void setValue(next === null ? null : routeParam(next));
  };

  return [parseRouteParam(value), select];
};
