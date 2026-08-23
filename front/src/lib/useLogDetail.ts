"use client";

import { api, readApiError } from "@lib/api";
import { logDetailUrl } from "@lib/logQuery";
import { LOGS_TEXT } from "@text/logs";
import { useEffect, useMemo, useState } from "react";

import type { LogDetail, LogRow } from "@lib/logTypes";

/**
 * What the hook answers, named because the table takes it as one prop.
 *
 * One object rather than three: `LogTableRow` is memoised over its props, and three fields that
 * change together would be three chances for every row in the list to re-render because one of
 * them was opened.
 */
export type LogDetailState = { detail: LogDetail | null; loading: boolean; error: string | null };

/**
 * The expanded row, in full — IKN-58.
 *
 * Same shape as `useTrace` and for the same reasons: one thing the reader pointed at, fetched when
 * they point at it, aborted when they stop. It is separate from `useLogSearch` because the list is
 * the filter set and this is one line out of it.
 *
 * **Keyed on the row's id and timestamp, not on the row object.** The feed re-renders on every
 * tailed line, and a dependency on the object's identity would re-fetch the open row several times
 * a second while a live tail runs.
 *
 * `detail` is cleared the instant the id changes, before the new request resolves. Keeping the
 * previous one would paint the last row's client address under the newly-expanded line — a wrong
 * answer that looks exactly like a right one, which is the only kind worth defending against here.
 */
export const useLogDetail = (row: LogRow | null): LogDetailState => {
  const [detail, setDetail] = useState<LogDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Empty for a row that arrived over the live tail: it has been written but never read back, so
   * it does not know its autoincrement value and there is nothing to address. That is not a
   * failure to report — the pane shows what the line carries, exactly as it did before this hook
   * existed — so it is the same branch as "no row open at all".
   */
  const id = row?.id ?? "";
  const ts = row?.ts ?? "";

  useEffect(() => {
    setDetail(null);
    setError(null);

    if (id === "") {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;
    setLoading(true);

    void (async () => {
      try {
        const response = await api(logDetailUrl({ id, ts }), { signal });
        setDetail(response.data as LogDetail);
      } catch (failure) {
        // An abort is this row being collapsed or replaced, not a failure: painting "could not
        // load" on the way out would be a lie about a request nobody is waiting for any more.
        if (signal.aborted) return;
        setError(readApiError(failure, LOGS_TEXT.detailFailed));
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [id, ts]);

  return useMemo(() => ({ detail, loading, error }), [detail, loading, error]);
};
