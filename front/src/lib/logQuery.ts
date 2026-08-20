"use client";

import { boundsFor, DEFAULT_RANGE, isRangeKey } from "@lib/timeRange";
import { parseAsArrayOf, parseAsString, parseAsStringLiteral, useQueryState, useQueryStates } from "nuqs";
import { useCallback, useMemo, useState } from "react";

import type { Bounds, RangeKey } from "@lib/timeRange";

/**
 * **The one place a log query is built.** — IKN-12 §1.
 *
 * The search, the histogram and the live tail take the same parameters and must interpret them
 * identically. The API enforces half of that (`nest-api/src/logs/log-query.ts` parses once for all
 * four routes); this file is the other half. Three consumers, one builder — otherwise the
 * histogram totals stop matching the list under it, and the tail shows lines the bar above it
 * excludes, and nobody notices until the numbers are being trusted.
 *
 * Everything lives in the URL. A search is then a link: it survives a reload, it is shareable, and
 * the back button walks the history of what was being looked at, which is what anyone debugging at
 * 3am reaches for without thinking about it.
 */

/**
 * The filter vocabulary, matching the API's query parameters one-for-one.
 *
 * `service` is deliberately the same parameter the rail already writes (`@lib/chassisState`), not a
 * second one: picking a service in the rail *is* setting this filter, and two keys meaning the same
 * thing would drift the moment one of them was set from the other place.
 */
export const LOG_FILTER_KEYS = ["service", "level", "route", "status", "q"] as const;

export type LogFilterKey = (typeof LOG_FILTER_KEYS)[number];

export type LogFilterValues = Record<LogFilterKey, string | null>;

/**
 * A filter that is off keeps its value.
 *
 * The ticket is specific about this and it is the whole behaviour of the token bar: `×` when
 * active, `+` when not, dimmed either way, and never a value you have to retype. So "off" cannot
 * be modelled by clearing the parameter — it is a second, separate piece of state naming which
 * keys are currently not applied.
 *
 * In the URL that reads `?service=pfa-api&off=service`: the value is still there to be switched
 * back on, and a link shared in that state reopens showing exactly what the sender was looking at.
 */
const offParser = parseAsArrayOf(parseAsStringLiteral(LOG_FILTER_KEYS)).withDefault([]);

/**
 * The `off` list on its own, because `service` has a second writer.
 *
 * The rail sets `service` through `@lib/chassisState` rather than through `setValue` below — that
 * is deliberate, the two are the same parameter — but "off" is a *companion* of the value, and a
 * writer that sets one without the other leaves the pair inconsistent: the chip keeps saying `+`,
 * `buildLogQuery` keeps dropping the key, and the rail is inert with no visible reason why. So the
 * list is exported as its own hook and the rail maintains the same invariant `setValue` does,
 * against the same parser, instead of hard-coding the parameter name a second time.
 */
export const useFilterOff = () => useQueryState("off", offParser);

const valueParsers = {
  service: parseAsString,
  level: parseAsString,
  route: parseAsString,
  status: parseAsString,
  q: parseAsString,
};

/**
 * An explicit window, set by clicking a histogram bucket, which the range buttons cannot express.
 *
 * When both are present they win over `range`. Stored as ISO strings rather than as a synthetic
 * range key because the bucket is an arbitrary interval — `02:14:37 + 30s` is not `15m`, and
 * rounding it to one would move the very bar the user clicked on.
 */
const windowParsers = { from: parseAsString, to: parseAsString };

export type LogQueryState = {
  values: LogFilterValues;
  off: readonly LogFilterKey[];
  /** The window actually in force, always both bounds — the API rejects anything else. */
  bounds: Bounds;
  /** True when the window came from a histogram click rather than from the range buttons. */
  pinned: boolean;
};

/** Whether a key is currently applied: it has a value *and* has not been switched off. */
export const isFilterActive = (state: LogQueryState, key: LogFilterKey): boolean =>
  Boolean(state.values[key]) && !state.off.includes(key);

/**
 * The query string every consumer sends. **The only function that writes one.**
 *
 * `cursor` and `limit` are the caller's business — pagination belongs to the list and to nothing
 * else — so they are appended by `logSearchUrl` rather than living in the shared shape.
 *
 * A key that is off contributes nothing, exactly as if it had never been set: the API's parser
 * treats an absent parameter and an empty one the same way, but sending `?service=` and relying on
 * that is asking a remote coincidence to hold.
 */
export const buildLogQuery = (state: LogQueryState): URLSearchParams => {
  // Both bounds, unconditionally and first. `log_entry` is partitioned by day and the range
  // predicate is what lets MySQL discard whole partitions before evaluating anything else; the API
  // answers 400 without them, and the UI must never be able to ask.
  const params = new URLSearchParams({ from: state.bounds.from, to: state.bounds.to });

  for (const key of LOG_FILTER_KEYS) {
    const value = state.values[key];
    if (value && !state.off.includes(key)) params.set(key, value);
  }

  return params;
};

export const logSearchUrl = (state: LogQueryState, cursor?: string | null, limit?: number): string => {
  const params = buildLogQuery(state);
  if (cursor) params.set("cursor", cursor);
  if (limit) params.set("limit", String(limit));
  return `/logs?${params}`;
};

export const logHistogramUrl = (state: LogQueryState): string => `/logs/histogram?${buildLogQuery(state)}`;

/**
 * The tail's URL, built from the same state as the list above it.
 *
 * `to` is sent and the server deliberately ignores it — a `to` taken from the search bar is in the
 * past by the time the first line arrives, so honouring it would make the tail silently emit
 * nothing, which reads exactly like a system that has gone quiet. Sending the same string to all
 * three routes is worth more than trimming one parameter the server has already decided about.
 */
export const logStreamUrl = (state: LogQueryState): string => `/logs/stream?${buildLogQuery(state)}`;

/** The trace endpoint takes only the window — it is keyed by id, not by the filter set. */
export const logTraceUrl = (traceId: string, state: LogQueryState): string => {
  const params = new URLSearchParams({ from: state.bounds.from, to: state.bounds.to });
  return `/logs/trace/${encodeURIComponent(traceId)}?${params}`;
};

/**
 * The filter state, and the operations the token bar performs on it.
 *
 * `now` is held in state rather than read at render. `boundsFor` is a pure function of an instant,
 * so calling it during render would produce a new `to` on every pass — a new query string, a new
 * fetch, and a render loop that never settles. It advances only when `refresh` is called, which is
 * the honest model anyway: a relative range is a snapshot taken when you asked for it.
 */
export const useLogQueryState = (): {
  state: LogQueryState;
  range: RangeKey;
  setValue: (key: LogFilterKey, value: string | null) => void;
  toggle: (key: LogFilterKey) => void;
  clear: (key: LogFilterKey) => void;
  /** Pin an explicit window — the histogram's bucket click. */
  setWindow: (bounds: Bounds) => void;
  /** Back to the range buttons. */
  unpinWindow: () => void;
  /** Re-take `now`, and with it every relative bound. */
  refresh: () => void;
} => {
  const [values, setValues] = useQueryStates(valueParsers);
  const [off, setOff] = useFilterOff();
  const [window, setWindowParams] = useQueryStates(windowParsers);
  const [range] = useQueryState("range", parseAsString);
  const [now, setNow] = useState(() => new Date());

  // The constant, not a literal. `useTimeRange` in `@lib/chassisState` defaults the same
  // parameter through nuqs, so a second copy of the value here is two defaults that drift apart
  // silently — the range selector reading one window while the panel queries another.
  const rangeKey: RangeKey = isRangeKey(range) ? range : DEFAULT_RANGE;

  const pinned = Boolean(window.from && window.to);

  const bounds = useMemo<Bounds>(
    () => (window.from && window.to ? { from: window.from, to: window.to } : boundsFor(rangeKey, now)),
    [window.from, window.to, rangeKey, now],
  );

  const state = useMemo<LogQueryState>(() => ({ values, off, bounds, pinned }), [values, off, bounds, pinned]);

  const setValue = useCallback(
    (key: LogFilterKey, value: string | null) => {
      void setValues({ [key]: value || null });
      // Setting a value switches its chip back on. Typing into a filter you had just turned off and
      // seeing nothing happen is the one interaction this design could plausibly get wrong.
      if (value) void setOff((current) => current.filter((k) => k !== key));
    },
    [setValues, setOff],
  );

  const toggle = useCallback(
    (key: LogFilterKey) => {
      void setOff((current) => (current.includes(key) ? current.filter((k) => k !== key) : [...current, key]));
    },
    [setOff],
  );

  const clear = useCallback(
    (key: LogFilterKey) => {
      void setValues({ [key]: null });
      void setOff((current) => current.filter((k) => k !== key));
    },
    [setValues, setOff],
  );

  const setWindow = useCallback(
    (next: Bounds) => void setWindowParams({ from: next.from, to: next.to }),
    [setWindowParams],
  );

  const unpinWindow = useCallback(() => void setWindowParams({ from: null, to: null }), [setWindowParams]);

  const refresh = useCallback(() => setNow(new Date()), []);

  return { state, range: rangeKey, setValue, toggle, clear, setWindow, unpinWindow, refresh };
};
