"use client";

import { CHECKS, REVIEW } from "@lib/interfaces/aiRunTypes";
import { parseAsInteger, parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";

/**
 * The AI traces screens' view state (IKN-91, IKN-94), in the URL like every other piece of it.
 * `history: "replace"`: changing a filter or a reference is not a place to come back to.
 */

const REPLACE = { history: "replace" } as const;

/** The run list's filters and page. */
export const useRunFilters = () =>
  useQueryStates(
    {
      checks: parseAsStringLiteral(Object.values(CHECKS)),
      review: parseAsStringLiteral(Object.values(REVIEW)),
      prompt: parseAsString,
      model: parseAsString,
      page: parseAsInteger.withDefault(0),
    },
    REPLACE,
  );

/** The versions grid: which step, and which column is the reference (by its `version · model` key). */
export const useVersionView = () =>
  useQueryStates(
    {
      step: parseAsString,
      ref: parseAsString,
    },
    REPLACE,
  );
