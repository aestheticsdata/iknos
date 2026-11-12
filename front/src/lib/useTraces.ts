"use client";

import { usePolledResource } from "@lib/usePolledResource";
import { SIGNALS_POLL_MS } from "@lib/useServiceView";
import { useSlidingBounds } from "@lib/useSlidingBounds";
import { TRACES_TEXT } from "@text/traces";

import type { TraceDetail, TraceList, TraceSummary } from "@lib/interfaces/traceSpanTypes";
import type { RangeKey } from "@lib/timeRange";

/**
 * The Traces view's two reads (IKN-87).
 *
 * The list slides with the range on the service tiles' clock and is identified by the question,
 * not the URL, like `useSiteTraffic` — so it keeps its rows while the window's right edge moves.
 * The detail is read once per run: a finished run does not change, and one still running is
 * re-read by picking it again.
 */

/** A minute either side of the run, so a child that started a little before its root still comes back. */
const DETAIL_MARGIN_MS = 60_000;

const windowQuery = (from: string, to: string) => `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

/** One service's runs in the range. `null` service reads nothing. */
export const useTraceList = (service: string | null, range: RangeKey) => {
  const bounds = useSlidingBounds(range, SIGNALS_POLL_MS);
  const url =
    service === null ? null : `/traces?service=${encodeURIComponent(service)}&${windowQuery(bounds.from, bounds.to)}`;

  return usePolledResource<TraceList>(url, SIGNALS_POLL_MS, TRACES_TEXT.failed, service && `${service} ${range}`);
};

/** Every span of one run, bounded by the run's own extent. */
export const useTraceDetail = (run: TraceSummary | null) => {
  const url =
    run === null
      ? null
      : `/traces/${encodeURIComponent(run.traceId)}?${windowQuery(
          new Date(run.startUs / 1000 - DETAIL_MARGIN_MS).toISOString(),
          new Date((run.startUs + run.durationUs) / 1000 + DETAIL_MARGIN_MS).toISOString(),
        )}`;

  return usePolledResource<TraceDetail>(url, null, TRACES_TEXT.detailFailed, run?.traceId ?? null);
};
