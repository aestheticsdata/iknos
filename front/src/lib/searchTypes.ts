/**
 * What `GET /api/search` returns, restated — the authoritative copy is
 * `nest-api/src/contracts/search.ts`, like every other contract in this front end.
 */

import type { Meta } from "@lib/logTypes";

/**
 * Mirrors `contracts/search.ts`.
 *
 * `view` is on this side only: the set of views is the front's own routing table, so the palette
 * contributes those itself and spends no round trip on "go to logs". `issue` joined both sides with
 * IKN-9 and IKN-14, which are the tickets that gave it rows — until they did, a type that always
 * returned nothing would have taught the reader the palette was broken.
 */
export type SearchHitType = "service" | "route" | "trace" | "issue" | "view";

export type SearchHit = {
  type: SearchHitType;
  label: string;
  /** What the action operates on — a service name, a path, a trace id, a fingerprint, a route. */
  value: string;
  hint: string | null;
};

/** Mirrors `contracts/search.ts`. */
export type SearchResults = {
  hits: SearchHit[];
  meta: Meta;
};
