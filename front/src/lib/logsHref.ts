import { ROUTES } from "@lib/routes";

import type { LogFilterKey } from "@lib/logQuery";
import type { Bounds, RangeKey } from "@lib/timeRange";

/**
 * A link **into** the log view — the one thing `logQuery.ts` does not build.
 *
 * Its four `*Url` helpers look like they would do this and are API paths: `logSearchUrl` is handed
 * to `api()`, which prefixes `/api`. Worse, they emit `from`/`to` as absolute ISO instants, and the
 * log view reads that pair back as a *pinned* window which overrides the range buttons — so using
 * one as an `href` would silently drop the range the reader had selected and replace it with a
 * frozen copy of the same interval.
 *
 * So this is a separate function, emitting the keys the **browser** uses: the filter values, the
 * `off` companion list, and `range` rather than a pair of instants. A pinned window is passed
 * explicitly, by a caller that means it.
 *
 * Pure, and in its own module rather than beside its siblings, so that it can be tested without
 * dragging `nuqs` and React into a node test run.
 */

export type LogsHref = {
  /** The range in force, carried across so the destination opens on the same window. */
  range: RangeKey;
  /** The filters to apply. A `null` or empty value contributes nothing. */
  values?: Partial<Record<LogFilterKey, string | null | undefined>>;
  /**
   * A trace to open on arrival — `?trace=`, which is not a filter and is not in `LOG_FILTER_KEYS`.
   *
   * Its own field for exactly that reason: `trace` is a separate piece of view state owned by
   * `traceState.ts`, and widening the filter map to hold it would put a value into `off`'s
   * vocabulary that can never be switched off. Added for IKN-14, whose modal exists to get from an
   * error to the request that produced it — the one Done item that was blocked by a type signature.
   */
  trace?: string | null;
  /**
   * An explicit window, which overrides `range` at the destination.
   *
   * Only for a caller pointing at a *moment* — the instant a probe failed, the interval a bar
   * covers. A tile carrying the reader's current range must leave this out, or the range buttons
   * arrive already overruled.
   */
  bounds?: Bounds | null;
};

export const logsHref = ({ range, values = {}, trace = null, bounds = null }: LogsHref): string => {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value);
  }

  /*
   * No `off`, and that is the point rather than an omission.
   *
   * `off` is the companion of the values — the token bar keeps a filter's value while dimming it
   * (IKN-35) — and it lives in the URL, so it would survive a navigation that carried it. Building
   * the query fresh drops it, which is what makes every filter this link names arrive switched
   * **on**: a link that set `level=error` under an inherited `off=level` would land on a log view
   * showing everything, with a dimmed chip as the only clue why.
   *
   * The same freshness drops the reader's other filters, deliberately. "Show me this service's
   * errors over this range" is the whole of what a tile asks; carrying a half-remembered `route`
   * token into it would answer a narrower question than the one that was clicked.
   */

  /*
   * The range travels even when a window is pinned.
   *
   * The log view reads `from`/`to` as a pinned window that overrides the range buttons, so the two
   * are not in conflict — but the moment the reader unpins it, `range` is what the window falls
   * back to. Sending only the bounds would drop them onto the default seven days, having arrived
   * from a screen showing one hour.
   */
  params.set("range", range);
  if (trace) params.set("trace", trace);
  if (bounds) {
    params.set("from", bounds.from);
    params.set("to", bounds.to);
  }

  return `${ROUTES.logs}?${params}`;
};
