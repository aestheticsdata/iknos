"use client";

import { api } from "@lib/api";
import { useEffect, useRef, useState } from "react";

import type { SearchHit, SearchResults } from "@lib/searchTypes";
import type { Bounds } from "@lib/timeRange";

/**
 * The palette's data (IKN-22 §2).
 *
 * Two rules the ticket is explicit about, and both exist to stop the list showing an answer to a
 * question that is no longer being asked.
 *
 * **Debounced**, so typing `iknos-api` is one query rather than nine — the last two of which are
 * the only ones anybody wanted.
 *
 * **The previous request is aborted**, which is the half that actually matters. Without it a fast
 * typist's requests race, the slowest wins because it lands last, and the palette settles on the
 * results for a prefix of what is in the box. That failure is invisible in development, where
 * every query is fast and they never overtake each other.
 */

/** Long enough to swallow a burst of typing, short enough to feel like it is keeping up. */
export const DEBOUNCE_MS = 140;

/** Matches the API's own floor: below this it declines to query and returns nothing. */
export const MIN_QUERY_LENGTH = 2;

export type PaletteSearch = {
  hits: SearchHit[];
  loading: boolean;
  failed: boolean;
};

export const usePaletteSearch = (term: string, bounds: Bounds, enabled: boolean): PaletteSearch => {
  const [result, setResult] = useState<{ term: string; hits: SearchHit[] } | null>(null);
  const [failed, setFailed] = useState(false);

  /*
   * Bumped by every teardown and checked by every response before it writes — the same guard the
   * log hooks use. The abort below covers the request; this covers the answer that was already on
   * the wire when the abort fired.
   */
  const generation = useRef(0);

  const trimmed = term.trim();
  const tooShort = trimmed.length < MIN_QUERY_LENGTH;

  useEffect(() => {
    if (!enabled || tooShort) return;

    const generationAtStart = generation.current;
    const controller = new AbortController();

    const timer = setTimeout(() => {
      const load = async () => {
        try {
          const params = new URLSearchParams({ q: trimmed, from: bounds.from, to: bounds.to });
          const response = await api(`/search?${params}`, { signal: controller.signal });
          if (generation.current !== generationAtStart) return;

          setResult({ term: trimmed, hits: (response.data as SearchResults).hits });
          setFailed(false);
        } catch {
          // An abort arrives here too, and is dismissed by the same check: the teardown that fired
          // it bumped the generation first.
          if (generation.current !== generationAtStart) return;
          setFailed(true);
        }
      };
      void load();
    }, DEBOUNCE_MS);

    return () => {
      generation.current += 1;
      clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, tooShort, trimmed, bounds.from, bounds.to]);

  /*
   * Read back only for the term in the box.
   *
   * Tagging by term is what keeps the list from showing the previous search's hits under the
   * current text for the moment between a keystroke and its answer — results that look every bit
   * as authoritative as the right ones, and are one letter out of date.
   */
  const hits = result !== null && result.term === trimmed ? result.hits : [];
  return { hits, loading: !tooShort && result?.term !== trimmed && !failed, failed };
};
