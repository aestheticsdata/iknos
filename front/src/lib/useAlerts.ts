"use client";

import { useToast } from "@components/ui/Toast";
import { useAlertClaims } from "@lib/alertClaims";
import { readApiError } from "@lib/api";
import { mutateWithCsrf } from "@lib/csrf";
import { usePolledResource } from "@lib/usePolledResource";
import { ALERTS_TEXT } from "@text/alerts";
import { useCallback, useEffect, useMemo } from "react";

import type { AlertHistory, AlertPage, AlertRow, AlertView, Severity } from "@lib/alertTypes";

/**
 * The reads and the writes behind the alert surfaces (IKN-15).
 *
 * The same split `useIssues` makes: the list polls because the engine writes to it on a timer, and
 * a single alert's history does not move while a modal is open over it.
 */

/**
 * **Half the engine's own cadence, not a number picked for feel.**
 *
 * `AlertEngine.EVAL_INTERVAL_MS` is 60 s, so nothing in `alert` can change faster than that;
 * polling at half of it means the view is never more than half a cycle behind, and polling faster
 * would be the same rows, more often. This is the `ISSUES_POLL_MS` precedent — if the engine's
 * interval changes, this is the number that has to follow it.
 *
 * The *displayed* cadence is a different matter and is never this constant: it rides the payload
 * as `evalIntervalMs`, so the modal cannot be wrong about it.
 */
export const ALERTS_POLL_MS = 30_000;

/** The rail panel's ceiling, like the issues panel's. A rail that scrolls everything is not a rail. */
export const RAIL_LIMIT = 3;

const query = (...parts: (string | null)[]): string => parts.filter((part): part is string => !!part).join("&");

const scoped = (service: string | null): string | null =>
  service === null ? null : `service=${encodeURIComponent(service)}`;

/**
 * A page of alerts.
 *
 * `active` gates the **URL** and never the identity — the rule `useServiceSignals` records, and the
 * reason is the same: gating both blanks the panel in the first frame of anything that hides it.
 *
 * `rows` is the payload with the claim overlay applied, so an alert the reader has just
 * acknowledged leaves the list in the frame they clicked rather than at the next poll.
 */
export const useAlerts = (
  service: string | null,
  view: AlertView,
  { severity = null, limit, active = true }: { severity?: Severity | null; limit?: number; active?: boolean } = {},
) => {
  const question = `${service ?? "all"} ${view} ${severity ?? "any"} ${limit ?? "page"}`;
  const url = active
    ? `/alerts?${query(scoped(service), `state=${view}`, severity && `severity=${severity}`, limit ? `limit=${limit}` : null)}`
    : null;

  const polled = usePolledResource<AlertPage>(url, ALERTS_POLL_MS, ALERTS_TEXT.failed, active ? question : null);
  const claims = useAlertClaims();
  const rows = polled.data?.rows;

  // In an effect, not during render: it writes to a provider above this hook. Runs once per
  // payload — `rows` is a new array only when a response landed.
  useEffect(() => {
    if (rows !== undefined) claims.reconcile(rows, view === "open");
  }, [rows, view, claims.reconcile]);

  const visible = useMemo(
    () => (rows ?? []).filter((row) => !(view === "open" && claims.claimed(row.id))),
    [rows, view, claims.claimed],
  );

  return { ...polled, rows: visible, evalIntervalMs: polled.data?.evalIntervalMs ?? null };
};

/**
 * One alert's transitions — the modal's band.
 *
 * Not polled, for the reason `useIssueDetail` is not: a modal is a thing the reader is looking at,
 * and re-fetching under them changes a pane nobody asked to change.
 */
export const useAlertHistory = (id: number | null) =>
  usePolledResource<AlertHistory>(id === null ? null : `/alerts/${id}/history`, null, ALERTS_TEXT.failed);

/** One alert in full, for the modal's head. Not polled, same reason. */
export const useAlertDetail = (id: number | null) =>
  usePolledResource<AlertRow>(id === null ? null : `/alerts/${id}`, null, ALERTS_TEXT.failed);

export type AlertAction = "ack" | "silence" | "resolve";

const LANDED: Record<AlertAction, string> = {
  ack: ALERTS_TEXT.acked,
  silence: ALERTS_TEXT.silenced,
  resolve: ALERTS_TEXT.resolved,
};

/**
 * The three actions, applied optimistically and rolled back if the server disagrees.
 *
 * All three end the same way for the default view — the row leaves it — which is why the claim is a
 * set rather than a map. See `alertClaims.tsx`.
 */
export const useAlertActions = () => {
  const toast = useToast();
  const claims = useAlertClaims();

  const run = useCallback(
    async (id: number, action: AlertAction) => {
      claims.claim(id);

      try {
        await mutateWithCsrf(`/alerts/${id}/${action}`);
        toast.show(LANDED[action], "ok");
        // The claim stands until a payload agrees with it — dropping it here would put the row
        // back for the rest of the poll interval, having just been acknowledged.
      } catch (cause) {
        // The rollback, and there is nothing to undo: the row was only ever hidden by the claim.
        claims.drop(id);
        toast.show(readApiError(cause, ALERTS_TEXT.actionFailed), "error");
      }
    },
    [claims.claim, claims.drop, toast],
  );

  return run;
};
