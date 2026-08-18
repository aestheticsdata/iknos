"use client";

import { DEFAULT_RANGE, RANGE_KEYS } from "@lib/timeRange";
import { parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";

/**
 * The two things the rail scopes everything by, both in the URL — §4.
 *
 * The rail is *scoping*: picking a service reconfigures every view, so the selection cannot live
 * in a component. Putting it in the query string rather than in a context also means the back
 * button walks the history of what was being looked at, which is the behaviour anyone debugging
 * at 3am reaches for without thinking about it.
 */

/** `null` means every service — the rail's `all` row, and the default. */
export const useSelectedService = () => useQueryState("service", parseAsString);

export const useTimeRange = () => useQueryState("range", parseAsStringLiteral(RANGE_KEYS).withDefault(DEFAULT_RANGE));
