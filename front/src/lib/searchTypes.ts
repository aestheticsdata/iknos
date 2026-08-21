/**
 * What `GET /api/search` returns, restated — the authoritative copy is
 * `nest-api/src/contracts/search.ts`, like every other contract in this front end.
 */

import type { Meta } from "@lib/logTypes";

/**
 * Mirrors `contracts/search.ts`.
 *
 * `view` is on this side only: the set of views is the front's own routing table, so the palette
 * contributes those itself and spends no round trip on "go to logs". `issue` is in neither, and
 * joins both with M3 — a type that always returns nothing teaches the reader the palette is broken.
 */
export type SearchHitType = "service" | "route" | "trace" | "view";

export type SearchHit = {
  type: SearchHitType;
  label: string;
  /** What the action operates on — a service name, a path, a trace id, a route. */
  value: string;
  hint: string | null;
};

/** Mirrors `contracts/search.ts`. */
export type SearchResults = {
  hits: SearchHit[];
  meta: Meta;
};
