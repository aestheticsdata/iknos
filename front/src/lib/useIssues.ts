"use client";

import { useToast } from "@components/ui/Toast";
import { api, readApiError, statusOf } from "@lib/api";
import { mutateWithCsrf } from "@lib/csrf";
import { useIssueClaims } from "@lib/issueClaims";
import { useOpenIssue } from "@lib/issueState";
import { usePolledResource } from "@lib/usePolledResource";
import { ISSUES_TEXT } from "@text/issues";
import { useCallback, useEffect, useMemo } from "react";

import type { IssueDetail, IssuePage, IssueSort, IssueStatus, OccurrenceSeries } from "@lib/issueTypes";

/**
 * The reads and the writes behind the issues surfaces (IKN-14).
 *
 * Four reads against four routes, because they answer different questions on different clocks —
 * the same split `useServiceView` makes and for the same reason. The list and the counts move
 * together and are polled; a single issue's detail and its chart do not move while a modal is open
 * over them, and re-fetching a stack every fifteen seconds would be paying for a payload nobody
 * asked to change.
 */

/**
 * **Bounded below by the collector, chosen above it.**
 *
 * `GrouperService.GROUP_INTERVAL_MS` is 15 s, so `issue` cannot change faster than that and
 * polling faster would be the same rows more often. But the writer's rate is a *ceiling*, not a
 * requirement: nobody triaging errors needs to learn about a new one inside fifteen seconds, and
 * this is a tab people leave open all day. Thirty is half the traffic for a staleness nobody can
 * perceive.
 *
 * Below 15 s this would be waste; above about a minute it would start to feel stale on a screen
 * somebody is actually watching during an incident. This sits between the two on purpose.
 */
export const ISSUES_POLL_MS = 30_000;

/** The rail panel's ceiling. A rail that scrolls everything is not a rail (IKN-14 §2). */
export const RAIL_LIMIT = 4;

const scoped = (service: string | null): string => (service === null ? "" : `service=${encodeURIComponent(service)}`);

const query = (...parts: (string | null)[]): string => parts.filter((part): part is string => !!part).join("&");

/**
 * A page of issues.
 *
 * `active` gates the **URL** and never the identity — the rule `useServiceSignals` records: gating
 * both would blank the panel in the first frame of anything that hides it, which is the animation
 * showing its own machinery.
 *
 * The identity is the question — this service, this segment, this sort, this many — so a retry
 * replaces the rows in place instead of blanking them to "reading…" while the answer travels.
 *
 * `rows` is the payload's rows with the claim overlay applied — see `issueClaims.tsx`. Callers read
 * that rather than `data.rows`, or a row the reader has just resolved sits there until the next
 * poll.
 */
export const useIssues = (
  service: string | null,
  status: IssueStatus | null,
  { sort = "last", limit, active = true }: { sort?: IssueSort; limit?: number; active?: boolean } = {},
) => {
  const question = `${service ?? "all"} ${status ?? "any"} ${sort} ${limit ?? "page"}`;
  const url = active
    ? `/issues?${query(scoped(service), status && `status=${status}`, `sort=${sort}`, limit ? `limit=${limit}` : null)}`
    : null;

  const polled = usePolledResource<IssuePage>(url, ISSUES_POLL_MS, ISSUES_TEXT.failed, active ? question : null);
  const claims = useIssueClaims();
  const rows = polled.data?.rows;

  /*
   * Every payload settles the claims it can — see `issueClaims.tsx`.
   *
   * In an effect rather than during render because it writes to a provider above this hook, and a
   * render that sets state in another component is exactly what React refuses. It runs once per
   * payload: `rows` is a new array only when a response landed.
   */
  useEffect(() => {
    if (rows !== undefined) claims.reconcile(rows, status);
  }, [rows, status, claims.reconcile]);

  /*
   * A row whose claimed status has left this segment is hidden at once, which is the whole of what
   * "optimistic" means here. The rollback needs no undo: a failure drops the claim and the row is
   * simply back, because it never left the payload.
   */
  const visible = useMemo(
    () => (rows ?? []).filter((row) => status === null || claims.statusOf(row) === status),
    [rows, status, claims.statusOf],
  );

  return { ...polled, rows: visible };
};

/*
 * The three segment counts used to live here, as a hook three components called independently.
 * They are now one poll for the whole chassis — see `useIssueCounts.ts` for why that matters and
 * why it is scoped to the rail's selection where the alerts counter is not.
 */

/**
 * One issue in full — the modal's head and its stack.
 *
 * **Not polled.** A modal is a thing the reader is looking at; the count behind it ticking while
 * they read the stack changes a number nobody is watching and re-renders the pane they are. The
 * list underneath is still polling, so nothing here goes stale for longer than the modal is open.
 */
export const useIssueDetail = (fingerprint: string | null) =>
  usePolledResource<IssueDetail>(
    fingerprint === null ? null : `/issues/${encodeURIComponent(fingerprint)}`,
    null,
    ISSUES_TEXT.failed,
  );

/**
 * The modal's 48-hour chart.
 *
 * No range in the URL: the window is the server's, which is what keeps this URL stable — a `now`
 * on the query string would re-fetch, and blank, every time the clock moved.
 */
export const useOccurrences = (fingerprint: string | null) =>
  usePolledResource<OccurrenceSeries>(
    fingerprint === null ? null : `/issues/${encodeURIComponent(fingerprint)}/occurrences`,
    null,
    ISSUES_TEXT.failed,
  );

/**
 * `⌘I` — open the issue a log line was grouped into (IKN-14, design doc §6).
 *
 * A call rather than a polled resource, because it is a *gesture*: the reader presses a key and
 * either arrives somewhere or is told there is nowhere to go. Nothing about it wants a
 * subscription — there is no id until the key is pressed, and the answer does not change while
 * they read it.
 *
 * The window is what `log_entry` insists on (IKN-19), and it is the one the reader is already
 * looking at — the row came off that page, so it is in that range by construction.
 *
 * A 404 covers three absences the API deliberately does not distinguish: not an error, not grouped
 * yet, no longer in range. All three mean the same thing to somebody pressing a key, and three
 * sentences for one shrug would be worse than one.
 */
export const useOpenIssueForLog = () => {
  const toast = useToast();
  const [, openIssue] = useOpenIssue();

  /** Resolves to whether an issue was actually opened — the caller may have a panel to close. */
  return useCallback(
    async (id: string, bounds: { from: string; to: string }): Promise<boolean> => {
      // A live-tail row has no id yet — there is nothing to look up, and saying so is better than
      // a request that cannot succeed.
      if (id === "") {
        toast.show(ISSUES_TEXT.noIssueForLine, "neutral");
        return false;
      }

      const range = `from=${encodeURIComponent(bounds.from)}&to=${encodeURIComponent(bounds.to)}`;

      try {
        const { data } = await api(`/issues/for-log/${id}?${range}`);
        openIssue((data as IssueDetail).fingerprint);
        return true;
      } catch (cause) {
        toast.show(statusOf(cause) === 404 ? ISSUES_TEXT.noIssueForLine : ISSUES_TEXT.failed, "neutral");
        return false;
      }
    },
    [openIssue, toast],
  );
};

export type IssueAction = "resolve" | "ignore" | "reopen";

const LANDED: Record<IssueAction, string> = {
  resolve: ISSUES_TEXT.resolved,
  ignore: ISSUES_TEXT.ignored,
  reopen: ISSUES_TEXT.reopened,
};

/** What each action claims the issue's status is, before the server has confirmed it. */
const CLAIMS: Record<IssueAction, IssueStatus> = {
  resolve: "resolved",
  ignore: "ignored",
  reopen: "unresolved",
};

/**
 * The three state changes, applied optimistically and rolled back if the server disagrees.
 *
 * The optimism itself lives in `issueClaims.tsx`, above every list, because the modal that raises
 * these is mounted on the chassis and is not a child of the list it changes. What is here is the
 * round trip and the two things it can say.
 */
export const useIssueActions = () => {
  const toast = useToast();
  const claims = useIssueClaims();

  const run = useCallback(
    async (fingerprint: string, action: IssueAction) => {
      claims.claim(fingerprint, CLAIMS[action]);

      try {
        await mutateWithCsrf(`/issues/${encodeURIComponent(fingerprint)}/${action}`);
        toast.show(LANDED[action], "ok");
        // The claim is **not** dropped here. It stands until a payload agrees with it — otherwise
        // the row returns for the rest of the poll interval, having just been resolved.
      } catch (cause) {
        // The rollback, and there is nothing to undo: the row was only ever hidden by the claim.
        claims.drop(fingerprint);
        toast.show(readApiError(cause, ISSUES_TEXT.actionFailed), "error");
      }
    },
    [claims.claim, claims.drop, toast],
  );

  return { run, statusOf: claims.statusOf };
};
