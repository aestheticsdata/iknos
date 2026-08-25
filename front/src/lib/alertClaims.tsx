"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

import type { AlertRow } from "@lib/alertTypes";

/**
 * What the reader has just done to an alert, before the server has confirmed it (IKN-15 §3).
 *
 * Simpler than `issueClaims.tsx` and deliberately its own file rather than a generalisation of it:
 * an issue moves *between* three segments and the claim has to say which one, while all three alert
 * actions do the same thing to the default view — they take the row out of it. So a claim here is a
 * set, not a map, and the two files stay readable instead of sharing a type parameter that would
 * make neither obvious.
 *
 * **Above the lists**, for the same reason: the modal is mounted on the chassis so `?alert=` opens
 * it from any view, and the claim it makes has to be visible to a panel it is not a child of.
 *
 * **Claims are settled by the data, never by a timer.** A claim stands until a payload agrees with
 * it. A timer would either flash the row back before the poll landed, or outrank the server
 * indefinitely — and the second is the worse failure here, because an alert that lapsed out of its
 * silence and started firing again would stay invisible under a stale claim.
 */

type Claims = {
  /** Whether this alert should be treated as already out of the default view. */
  claimed: (id: number) => boolean;
  claim: (id: number) => void;
  drop: (id: number) => void;
  /** Called by a list with the page it was handed: claims the server agrees with are dropped. */
  reconcile: (rows: AlertRow[], attentionOnly: boolean) => void;
};

const ClaimsContext = createContext<Claims | null>(null);

export const AlertClaimsProvider = ({ children }: { children: React.ReactNode }) => {
  const [claims, setClaims] = useState<ReadonlySet<number>>(() => new Set());

  const claim = useCallback((id: number) => {
    setClaims((current) => (current.has(id) ? current : new Set(current).add(id)));
  }, []);

  const drop = useCallback((id: number) => {
    setClaims((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  const claimed = useCallback((id: number) => claims.has(id), [claims]);

  const reconcile = useCallback((rows: AlertRow[], attentionOnly: boolean) => {
    setClaims((current) => {
      if (current.size === 0) return current;

      const served = new Set(rows.map((row) => row.id));
      const next = new Set<number>();

      for (const id of current) {
        /*
         * Gone from a list that only shows what needs attention: that is a confirmation, not an
         * absence. Acknowledging, silencing and resolving all end with the row leaving this list,
         * so "no longer here" is exactly what success looks like.
         *
         * On any other segment its absence says nothing — it may be on a later page or under
         * another service — and dropping the claim there would flash the row back.
         */
        if (attentionOnly && !served.has(id)) continue;
        next.add(id);
      }

      return next.size === current.size ? current : next;
    });
  }, []);

  const value = useMemo(() => ({ claimed, claim, drop, reconcile }), [claimed, claim, drop, reconcile]);

  return <ClaimsContext.Provider value={value}>{children}</ClaimsContext.Provider>;
};

/** Throws rather than no-opping: a claim silently never made is a bug you chase in the UI. */
export const useAlertClaims = (): Claims => {
  const context = useContext(ClaimsContext);
  if (context === null) throw new Error("useAlertClaims must be used inside an <AlertClaimsProvider>");
  return context;
};
