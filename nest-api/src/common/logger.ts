import ecsFormat from "@elastic/ecs-pino-format";
import pino from "pino";

import type { DestinationStream } from "pino";

/**
 * Printed on stderr when the database write path itself fails.
 *
 * The ingest parser (Task 13) skips any line containing it. Without that, a database outage
 * becomes an infinite loop: the write fails, the failure is logged, the log line is ingested,
 * the write of that line fails, and so on until the disk or the process gives out.
 */
export const INGEST_SKIP_MARKER = "IKNOS_SELF_ERR";

/**
 * The same emitter IKN-1 puts into PFA: pino with `@elastic/ecs-pino-format`.
 *
 * That is the whole point of the founding principle — Iknos writes ECS NDJSON to stdout exactly
 * like every application it watches, so it is monitored by its own pipeline with no special
 * casing, and swapping Iknos for Loki later changes nothing about how anything logs.
 */
export function buildLogger(level: string, dest?: DestinationStream) {
  return pino({ level, ...ecsFormat({ serviceName: "iknos" }) }, dest);
}

export const logger = buildLogger(process.env.IKNOS_LOG_LEVEL ?? "info");
