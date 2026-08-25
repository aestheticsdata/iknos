"use client";

import { ISSUE_SORTS } from "@lib/issueTypes";
import { parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { useCallback } from "react";

import type { IssueSort, IssueStatus } from "@lib/issueTypes";

/**
 * The issues view's state, in the URL (IKN-14).
 *
 * Everything the app has is in the query string — which service, which range, which filters, which
 * trace — for the reason `logQuery.ts` states: a view becomes a link, it survives a reload, and the
 * back button walks what was being looked at. Nothing here is an exception.
 *
 * **`seg`, not `status`.** `status` is already taken by the log list, where it is the HTTP status
 * filter, and the rail carries the whole query string across views so that a selection is not lost
 * on the way (`ServiceRail`'s `withScope`). Arriving at the issues view from `/logs?status=500`
 * would then land on a segment filter of `500`, which the API refuses — correctly, and confusingly.
 * Two parameters, two meanings, no collision.
 */

export const SEGMENTS: IssueStatus[] = ["unresolved", "resolved", "ignored"];

/** What the table opens on: the segment the reader is being asked to do something about. */
const segParser = parseAsStringLiteral(SEGMENTS).withDefault("unresolved");

/** Last seen first — what broke most recently is what a triage list opens on. */
const sortParser = parseAsStringLiteral(ISSUE_SORTS).withDefault("last");

export const useIssueSegment = (): [IssueStatus, (next: IssueStatus) => void] => {
  const [seg, setSeg] = useQueryState("seg", segParser);
  return [seg, useCallback((next: IssueStatus) => void setSeg(next), [setSeg])];
};

export const useIssueSort = (): [IssueSort, (next: IssueSort) => void] => {
  const [sort, setSort] = useQueryState("sort", sortParser);
  return [sort, useCallback((next: IssueSort) => void setSort(next), [setSort])];
};

/**
 * Which issue's modal is open, by fingerprint.
 *
 * In the URL rather than in component state because it is opened from three places — the rail
 * panel, the table, and `⌘I` from a log row on a different view entirely — and a piece of state
 * three components set is a piece of state that belongs above all three. It pays for itself the
 * same way `?trace=` does: sending someone `?issue=4f2ab91c9c0e17d4` is the useful half of a
 * conversation about an error.
 *
 * `history: "replace"`, like the trace param: stepping through four issues should not leave four
 * entries the back button has to walk out of. Closing one returns to the list, which is what back
 * means here.
 */
export const useOpenIssue = (): [string | null, (fingerprint: string | null) => void] => {
  const [issue, setIssue] = useQueryState("issue", parseAsString.withOptions({ history: "replace" }));

  return [issue, useCallback((next: string | null) => void setIssue(next), [setIssue])];
};
