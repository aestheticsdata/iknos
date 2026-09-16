import type { LogRecord } from "./log-record";

/** One file a source follows, and the service its lines belong to. */
export type SourceFile = { file: string; service: string; stream: "out" | "err" };

/**
 * Where log lines come from, and how to read one.
 *
 * These two methods are the only things in this module that ever knew what a log line looks like
 * — they were `serviceAndStream` and `parse`, called directly inside `Tailer.pollOne`. Everything
 * below them already dealt in `LogRecord`: the `Chunk`, the `Writer`, the bus, `persistBatch`,
 * the rotation arithmetic. Naming the pair is the whole of what a second source needed.
 */
export type Source = {
  /** Named in the log line when a sweep fails, so an outage says which source it was. */
  readonly name: string;

  /**
   * The files to sweep this pass.
   *
   * **Re-evaluated every tick rather than cached**, which is why `poll()` re-globbed before this
   * existed: a newly deployed PM2 app is picked up without restarting Iknos, and a newly
   * registered site inherits the same property for free.
   */
  files(): Promise<SourceFile[]>;

  /** One line into a record, or `null` to drop it. Never throws. */
  parse(line: string, service: string, stream: "out" | "err"): LogRecord | null;
};
