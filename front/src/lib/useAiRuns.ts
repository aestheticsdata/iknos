"use client";

import { usePolledResource } from "@lib/usePolledResource";
import { SIGNALS_POLL_MS } from "@lib/useServiceView";
import { useSlidingBounds } from "@lib/useSlidingBounds";
import { TRACES_TEXT } from "@text/traces";

import type { AiRunList, QualityReport, RunListQuery, VersionQuery, VersionReport } from "@lib/interfaces/aiRunTypes";
import type { TraceDetail } from "@lib/interfaces/traceSpanTypes";
import type { RangeKey } from "@lib/timeRange";

/**
 * The AI traces screens' reads (IKN-91 … IKN-94), on the service tiles' clock like every view.
 *
 * Each is identified by its question, not its URL — the window's right edge slides every poll, and
 * a URL-keyed read would blank the screen to "reading…" each time it did (`usePolledResource`).
 */

/** A run is a few minutes long and the retention two weeks: the detail reads the whole retention. */
const DETAIL_LOOKBACK_MS = 15 * 86_400_000;
const DETAIL_LOOKAHEAD_MS = 3_600_000;

/** One page of the run list. */
export const RUNS_PAGE_SIZE = 50;

const param = (key: string, value: string | null): string =>
  value === null ? "" : `&${key}=${encodeURIComponent(value)}`;

const windowOf = (from: string, to: string): string => `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

export const useRunList = (query: RunListQuery) => {
  const bounds = useSlidingBounds(query.range, SIGNALS_POLL_MS);
  const filters =
    param("service", query.service) +
    param("checks", query.filters.checks) +
    param("review", query.filters.review) +
    param("prompt", query.filters.prompt) +
    param("model", query.filters.model) +
    `&limit=${RUNS_PAGE_SIZE}&offset=${query.page * RUNS_PAGE_SIZE}`;
  const url = `/traces?${windowOf(bounds.from, bounds.to)}${filters}`;

  return usePolledResource<AiRunList>(url, SIGNALS_POLL_MS, TRACES_TEXT.failed, `${query.range}${filters}`);
};

/** One run's spans and its summary. Polled: a run still going keeps growing. */
export const useRunDetail = (traceId: string) => {
  const now = Date.now();
  const from = new Date(now - DETAIL_LOOKBACK_MS).toISOString();
  const to = new Date(now + DETAIL_LOOKAHEAD_MS).toISOString();
  const url = `/traces/${encodeURIComponent(traceId)}?${windowOf(from, to)}`;

  return usePolledResource<TraceDetail>(url, SIGNALS_POLL_MS, TRACES_TEXT.detailFailed, traceId);
};

/** One service's quality over the range. `null` service reads nothing. */
export const useQuality = (service: string | null, range: RangeKey) => {
  const bounds = useSlidingBounds(range, SIGNALS_POLL_MS);
  const url =
    service === null ? null : `/traces/quality?${windowOf(bounds.from, bounds.to)}${param("service", service)}`;

  return usePolledResource<QualityReport>(
    url,
    SIGNALS_POLL_MS,
    TRACES_TEXT.qualityFailed,
    service && `${service} ${range}`,
  );
};

export const useVersions = (query: VersionQuery) => {
  const bounds = useSlidingBounds(query.range, SIGNALS_POLL_MS);
  const url =
    query.service === null
      ? null
      : `/traces/versions?${windowOf(bounds.from, bounds.to)}${param("service", query.service)}${param("step", query.step)}`;

  return usePolledResource<VersionReport>(
    url,
    SIGNALS_POLL_MS,
    TRACES_TEXT.versionsFailed,
    query.service && `${query.service} ${query.step} ${query.range}`,
  );
};
