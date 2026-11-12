import type { AiRunSummary } from "./ai-runs";
import type { Meta } from "./meta";

/**
 * Test sets of AI runs (IKN-95): named regression sets a reader builds from the run detail. Each
 * run keeps a copy of its model calls' inputs and outputs, because the spans and their content
 * expire and a set must not.
 *
 * There is no replay here. An Officina pipeline runs in its visitor's browser, on their GPU; Iknos
 * has no channel into that page, so a "replay" button could only be a dead one. The set is the
 * cases — what went in, what came out, how it was judged — for the app's own test harness.
 */

/** One set as the list shows it. */
export type TestSetSummary = {
  id: number;
  service: string;
  name: string;
  /** ISO-8601. */
  createdAt: string;
  runs: number;
  /** When the last run was added, ISO-8601; `null` while empty. */
  lastAddedAt: string | null;
};

/** `GET /api/test-sets?service=` */
export type TestSetList = {
  sets: TestSetSummary[];
  meta: Meta;
};

/** One model call of a kept run: what went in and what came out. */
export type TestCall = {
  /** `officina.node.id` of the step that made it. */
  step: string | null;
  promptVersion: number | null;
  model: string | null;
  /** The content as sent, `null` when the run was not traced at `full` or it had expired. */
  system: unknown;
  input: unknown;
  output: unknown;
};

/** One run of a set. */
export type TestSetRun = {
  id: number;
  traceId: string;
  /** ISO-8601. */
  addedAt: string;
  /** The run as it was read when added. */
  run: AiRunSummary;
  calls: TestCall[];
  /** At least one call kept its input — the case can be run again by the app. */
  hasInputs: boolean;
};

/** `GET /api/test-sets/:id` */
export type TestSetDetail = {
  set: TestSetSummary;
  runs: TestSetRun[];
  meta: Meta;
};
