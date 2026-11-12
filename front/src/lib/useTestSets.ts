"use client";

import { mutateWithCsrf } from "@lib/csrf";
import { usePolledResource } from "@lib/usePolledResource";
import { SIGNALS_POLL_MS } from "@lib/useServiceView";
import { TRACES_TEXT } from "@text/traces";

import type { TestSetDetail, TestSetList, TestSetRun, TestSetSummary } from "@lib/interfaces/testSetTypes";

/**
 * The test sets' reads and writes (IKN-95). The reads poll on the service tiles' clock like every
 * view, so a run added from the run detail in another tab shows up here on its own.
 */

/** One service's sets, or every service's on `all`. */
export const useTestSets = (service: string | null) =>
  usePolledResource<TestSetList>(
    service === null ? "/test-sets" : `/test-sets?service=${encodeURIComponent(service)}`,
    SIGNALS_POLL_MS,
    TRACES_TEXT.setsFailed,
  );

/** One set and its runs; `null` reads nothing. */
export const useTestSet = (id: number | null) =>
  usePolledResource<TestSetDetail>(id === null ? null : `/test-sets/${id}`, SIGNALS_POLL_MS, TRACES_TEXT.setFailed);

export const createTestSet = (service: string, name: string): Promise<TestSetSummary> =>
  mutateWithCsrf<TestSetSummary>("/test-sets", { data: { service, name } });

export const addRunToSet = (setId: number, traceId: string): Promise<TestSetRun> =>
  mutateWithCsrf<TestSetRun>(`/test-sets/${setId}/runs`, { data: { traceId } });

export const removeRunFromSet = (setId: number, runId: number): Promise<unknown> =>
  mutateWithCsrf(`/test-sets/${setId}/runs/${runId}`, { method: "DELETE" });

export const deleteTestSet = (setId: number): Promise<unknown> =>
  mutateWithCsrf(`/test-sets/${setId}`, { method: "DELETE" });
