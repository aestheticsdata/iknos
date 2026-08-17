import { EventEmitter } from "node:events";
import { Injectable } from "@nestjs/common";

import type { LogRecord } from "../ingest/log-record";

/**
 * The in-process event bus between the writer and the live tail.
 *
 * This is the reason one Nest app hosts both the collector and the HTTP API: the tail streams
 * rows the writer just committed, straight from memory, instead of polling MySQL for "anything
 * new since the last poll" — which is both a query per second forever and a tail that lags by
 * the polling interval on the screen someone is staring at during an incident.
 *
 * Records are published **after** the transaction commits, never before: the tail must not show
 * a line a rollback then un-writes.
 */
@Injectable()
export class LogBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Each SSE connection adds a listener. The default cap of 10 would print a spurious leak
    // warning with a handful of open tabs.
    this.emitter.setMaxListeners(0);
  }

  emit(record: LogRecord): void {
    this.emitter.emit("log", record);
  }

  /**
   * Returns an unsubscribe function. Callers MUST call it on disconnect — listeners accumulating
   * on dead requests is the classic SSE memory leak.
   */
  subscribe(fn: (record: LogRecord) => void): () => void {
    this.emitter.on("log", fn);
    return () => this.emitter.off("log", fn);
  }
}
