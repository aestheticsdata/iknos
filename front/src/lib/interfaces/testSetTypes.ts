import type { AiRunSummary } from "@lib/interfaces/aiRunTypes";
import type { Meta } from "@lib/logTypes";

/**
 * Test sets of AI runs (IKN-95) — the front's copy of `nest-api/src/contracts/test-sets.ts`, which
 * is the authoritative one. No replay: Officina runs in its visitor's browser, out of Iknos's reach.
 */

export type TestSetSummary = {
  id: number;
  service: string;
  name: string;
  createdAt: string;
  runs: number;
  lastAddedAt: string | null;
};

export type TestSetList = {
  sets: TestSetSummary[];
  meta: Meta;
};

export type TestCall = {
  step: string | null;
  promptVersion: number | null;
  model: string | null;
  system: unknown;
  input: unknown;
  output: unknown;
};

export type TestSetRun = {
  id: number;
  traceId: string;
  addedAt: string;
  run: AiRunSummary;
  calls: TestCall[];
  hasInputs: boolean;
};

export type TestSetDetail = {
  set: TestSetSummary;
  runs: TestSetRun[];
  meta: Meta;
};

/** A call with its place in the run. */
export type NumberedCall = TestCall & {
  position: number;
};
