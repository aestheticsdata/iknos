"use client";

import { ALERT_VIEWS, SEVERITIES } from "@lib/alertTypes";
import { parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { useCallback } from "react";

import type { AlertView, Severity } from "@lib/alertTypes";

/**
 * The alerts view's state, in the URL (IKN-15).
 *
 * `state` and `sev` rather than the obvious names, for the reason `issueState.ts` chose `seg`: the
 * rail carries the whole query string across views, so a parameter here must not collide with one
 * the log list reads. `status` is the log list's HTTP filter and `level` is its severity — both
 * taken, both meaning something else. `state` and `sev` are free.
 */

const viewParser = parseAsStringLiteral(ALERT_VIEWS).withDefault("open");
const severityParser = parseAsStringLiteral(SEVERITIES);

export const useAlertView = (): [AlertView, (next: AlertView) => void] => {
  const [view, setView] = useQueryState("state", viewParser);
  return [view, useCallback((next: AlertView) => void setView(next), [setView])];
};

export const useAlertSeverity = (): [Severity | null, (next: Severity | null) => void] => {
  const [severity, setSeverity] = useQueryState("sev", severityParser);
  return [severity, useCallback((next: Severity | null) => void setSeverity(next), [setSeverity])];
};

/**
 * Which alert's modal is open, by id.
 *
 * In the URL for the same reasons `?issue=` is: it is opened from the rail panel and from the
 * table, and a link to one is the useful half of a conversation. `history: "replace"`, so stepping
 * through four alerts does not leave four entries the back button has to walk out of.
 */
export const useOpenAlert = (): [number | null, (id: number | null) => void] => {
  const [alert, setAlert] = useQueryState("alert", parseAsString.withOptions({ history: "replace" }));

  const id = alert !== null && /^\d+$/.test(alert) ? Number(alert) : null;

  return [id, useCallback((next: number | null) => void setAlert(next === null ? null : String(next)), [setAlert])];
};
