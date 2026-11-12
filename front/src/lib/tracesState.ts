"use client";

import { parseAsString, useQueryState } from "nuqs";

/**
 * Which run the Traces view has open (IKN-87), in the URL like every other piece of view state.
 *
 * **`run`, not `trace`.** `trace` is the log view's open trace (`traceState.ts`), and the rail
 * carries the whole query string across views — an OTLP trace id landing in the log view's modal
 * would ask `/api/logs/trace/…` for a run that logged no line. `history: "replace"`, like
 * `?endpoint=`: walking down the list should not leave one back-button entry per row.
 */
export const useSelectedRun = () => useQueryState("run", parseAsString.withOptions({ history: "replace" }));
