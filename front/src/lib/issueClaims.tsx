"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

import type { IssueRow, IssueStatus } from "@lib/issueTypes";

/**
 * What the reader has just done to an issue, before the server has confirmed it (IKN-14 §4).
 *
 * IKN-14 asks for optimistic updates in as many words, and the reason is the gesture: resolving an
 * issue is a triage action taken on a list, and a row that sits there unchanged for a round trip
 * invites a second click on something already resolved.
 *
 * **Above the lists rather than inside one**, and that is what this file is for. The modal is
 * mounted on the chassis so that `?issue=` opens it from any view — including `⌘I` on a log row,
 * which fires from a page that has no issues list at all — so the claim it makes has to be visible
 * to a list it is not a child of. A map keyed by fingerprint, one level above both.
 *
 * **Claims are dropped by the data, not by a timer.** A claim outlives exactly as long as the
 * server disagrees with it: every list reconciles what it was handed against what is claimed, and
 * a claim the payload has caught up with is deleted. A timer would either flash the old state back
 * before the poll landed or outrank the server indefinitely — and the second is worse, because an
 * issue the collector reopened as a regression would stay invisible under a stale "resolved".
 */

type Claims = {
  /** The status to render for a row: what was claimed for it, or what the server last said. */
  statusOf: (row: Pick<IssueRow, "fingerprint" | "status">) => IssueStatus;
  claim: (fingerprint: string, status: IssueStatus) => void;
  drop: (fingerprint: string) => void;
  /** Called by a list with the page it was handed: claims the server agrees with are dropped. */
  reconcile: (rows: Pick<IssueRow, "fingerprint" | "status">[], segment: IssueStatus | null) => void;
};

const ClaimsContext = createContext<Claims | null>(null);

export const IssueClaimsProvider = ({ children }: { children: React.ReactNode }) => {
  const [claims, setClaims] = useState<Record<string, IssueStatus>>({});

  const claim = useCallback((fingerprint: string, status: IssueStatus) => {
    setClaims((current) => ({ ...current, [fingerprint]: status }));
  }, []);

  const drop = useCallback((fingerprint: string) => {
    setClaims((current) => {
      if (!(fingerprint in current)) return current;
      const { [fingerprint]: _gone, ...rest } = current;
      return rest;
    });
  }, []);

  const statusOf = useCallback(
    (row: Pick<IssueRow, "fingerprint" | "status">) => claims[row.fingerprint] ?? row.status,
    [claims],
  );

  const reconcile = useCallback((rows: Pick<IssueRow, "fingerprint" | "status">[], segment: IssueStatus | null) => {
    setClaims((current) => {
      const keys = Object.keys(current);
      if (keys.length === 0) return current;

      const served = new Map(rows.map((row) => [row.fingerprint, row.status]));
      const next: Record<string, IssueStatus> = {};

      for (const fingerprint of keys) {
        const claimed = current[fingerprint];
        const actual = served.get(fingerprint);

        // The server agrees — the claim has nothing left to say.
        if (actual === claimed) continue;
        /*
         * The issue is no longer in this segment's page, and the claim is why it left. That is a
         * confirmation, not an absence: a list filtered to `unresolved` cannot show a resolved
         * issue, so "gone from here" is exactly what a successful resolve looks like.
         *
         * Only when the page *is* filtered, though. An unfiltered list that simply does not
         * contain the row — it is on a later page, or under another service — says nothing about
         * whether the change landed, and dropping the claim there would flash the row back.
         */
        if (segment !== null && actual === undefined && claimed !== segment) continue;

        next[fingerprint] = claimed;
      }

      return Object.keys(next).length === keys.length ? current : next;
    });
  }, []);

  const value = useMemo(() => ({ statusOf, claim, drop, reconcile }), [statusOf, claim, drop, reconcile]);

  return <ClaimsContext.Provider value={value}>{children}</ClaimsContext.Provider>;
};

/** Throws rather than no-opping: a claim that is silently never made is a bug you chase in the UI. */
export const useIssueClaims = (): Claims => {
  const context = useContext(ClaimsContext);
  if (context === null) throw new Error("useIssueClaims must be used inside an <IssueClaimsProvider>");
  return context;
};
