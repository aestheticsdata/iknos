import type { LogRow } from "./log-row";
import type { Meta } from "./meta";

/**
 * Every line that carried the same `trace.id`, in timestamp order.
 *
 * This is **not** a span tree and must not be presented as one: Iknos does not do distributed
 * tracing (backend spec §11). It is the course of one request reconstructed from the lines the
 * services happened to log, which is a weaker and more honest claim.
 *
 * `totalMs` spans the first row's timestamp to the last row's timestamp plus its own
 * `durationMs` — the wall-clock length of the request as the logs recorded it.
 */
export type Trace = {
  traceId: string;
  rows: LogRow[];
  totalMs: number;
  /**
   * The trace logged more lines than the endpoint returns, and `totalMs` therefore covers only
   * what came back. Reported rather than left implicit: a timeline silently cut at five hundred
   * lines is a claim about a request that is not true.
   */
  truncated: boolean;
  meta: Meta;
};
