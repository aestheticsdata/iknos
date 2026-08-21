import type { Meta } from "./meta";

/**
 * What the ⌘K palette consumes (IKN-22).
 *
 * **A hit is an action, not a link.** Choosing a service re-scopes every view, choosing a route
 * filters the log list on it, choosing a trace opens its timeline — so the payload carries the
 * value each action operates on rather than a URL, and the front decides what "open" means. A
 * server that returned hrefs would be deciding the interface's navigation from the database.
 */

/**
 * The types M1 can actually answer.
 *
 * `issue` is in the mockup's palette and is deliberately **absent rather than empty**: issues
 * arrive with M3 (IKN-9, IKN-14), and a type that always returns nothing teaches the reader the
 * palette does not work. It joins this union with the ticket that gives it rows.
 *
 * `view` is missing for a different reason — it is not data. The set of views is the front's own
 * routing table, so the palette contributes those itself and spends no round trip on "go to logs".
 */
export type SearchHitType = "service" | "route" | "trace";

export type SearchHit = {
  type: SearchHitType;
  /** What the row shows. */
  label: string;
  /** What the action operates on. Usually the label, kept separate so a prettier label stays free. */
  value: string;
  /** Secondary text — a count, a time. `null` when there is nothing worth adding. */
  hint: string | null;
};

/**
 * Hits from every source, already ordered: services, then routes, then traces.
 *
 * Ordered by how likely the intent is rather than by score — this is a literal prefix-and-substring
 * search, deliberately (fuzzy ranking is out of scope), so a relevance number would be invented.
 * Capped per type, so one busy source cannot crowd the others out of the list.
 */
export type SearchResults = {
  hits: SearchHit[];
  meta: Meta;
};
