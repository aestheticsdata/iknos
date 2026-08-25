import { diskSpace } from "./disk-space";
import { healthDown } from "./health-down";
import { errorRate, latencyP95 } from "./metric-rules";
import { noLogs } from "./no-logs";
import { processRestart } from "./process-restart";

import type { Rule } from "../rule";

/**
 * The six rules, in the order a pass evaluates them (IKN-10).
 *
 * Critical first, which is only cosmetic here — each rule is isolated and the order of evaluation
 * changes no outcome — but it means the log line a failing pass writes reads in the same order as
 * the view.
 *
 * Two of the ticket's eight are deliberately absent, and the design doc records why at length:
 * `ingest_lag` because `writer.ts:228` only assigns `lagMs` on the success path, so it freezes
 * during the database outage the rule exists to catch; `new_issue` because it would raise an info
 * alert directly above the issues panel already listing that error.
 */
export const RULES: Rule[] = [healthDown, processRestart, diskSpace, errorRate, latencyP95, noLogs];
