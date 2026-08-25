/**
 * One exception out of the several log rows it arrived as (IKN-9).
 *
 * **This is the reason the grouper reads `log_entry` on an interval instead of hooking the
 * writer.** An instrumented app emits an exception as one ECS line carrying `error.stack_trace`,
 * and that line needs nothing done to it. An app that merely writes to stderr — most of the fleet
 * — emits the same exception as a header line and a dozen `    at …` lines, and PM2 routes all of
 * them to `-error.log`, where `parser.ts` stamps every one of them `error` and hands back a
 * separate `LogRecord`. Fingerprinting per record would turn one throw into thirteen issues, each
 * with a count of one, which is worse than not grouping at all: the reader would have to
 * reassemble by eye what the tool exists to assemble for them.
 *
 * Rows have to be seen together to be joined, and they are only all present once they are
 * committed — which is what makes this a pass over the table rather than a hook in the path.
 */

/** The columns the grouper reads. A projection of `log_entry`, not the whole row. */
export type GroupableRow = {
  id: bigint;
  ts: Date;
  service: string;
  level: number;
  levelName: string;
  message: string;
  traceId: string | null;
  attrs: Record<string, unknown> | null;
};

/** One exception, reassembled: the head row plus whatever continuation lines belonged to it. */
export type Exception = {
  head: GroupableRow;
  /** The `    at …` lines that followed, in order, message only. Empty for an ECS line. */
  frames: string[];
};

/**
 * How long after its header a continuation line may still arrive and be joined to it.
 *
 * These are lines of one `console.error` — they are written in the same millisecond and read in
 * the same 256 KB chunk. A second is four orders of magnitude of headroom, and small enough that
 * two unrelated exceptions a second apart from one service cannot swallow each other.
 */
export const COALESCE_WINDOW_MS = 1_000;

/**
 * A V8 continuation line: `    at fn (/path:1:2)`, `    at /path:1:2`, or the `… 12 more` tail
 * that `Error.captureStackTrace` prints when it elides repeated frames.
 *
 * Anchored on leading whitespace, which is what separates a stack frame from a log line that
 * happens to begin with the word "at".
 */
const CONTINUATION = /^\s+(?:at\s+\S|\.{3}\s+\d+\s+more\s*$)/;

/** `Caused by: TypeError: …` opens a nested stack and belongs to the exception above it. */
const CAUSED_BY = /^\s*Caused by:\s/;

export const isContinuation = (message: string): boolean => CONTINUATION.test(message) || CAUSED_BY.test(message);

/**
 * Rows in `(ts, id)` order → the exceptions they represent.
 *
 * A continuation line joins the most recent head **from its own service**, and only if that head
 * is within `COALESCE_WINDOW_MS`. Per-service because two apps writing at once interleave in the
 * table but never in a file; time-bounded because a stack whose header aged out is a stack whose
 * header was dropped by the queue, and attaching it to whatever came before would invent an
 * exception nobody threw.
 *
 * A continuation line with no head to join is **discarded, not promoted**. It is half of
 * something, and a bare `at Object.<anonymous> (…)` as an issue of its own is noise with a
 * counter on it.
 */
export function coalesce(rows: GroupableRow[]): Exception[] {
  const exceptions: Exception[] = [];
  const openPerService = new Map<string, Exception>();

  for (const row of rows) {
    const open = openPerService.get(row.service);

    if (isContinuation(row.message)) {
      // Orphan — no head, or a head too old to still be speaking. Dropped on purpose.
      if (open === undefined) continue;
      if (row.ts.getTime() - open.head.ts.getTime() > COALESCE_WINDOW_MS) {
        openPerService.delete(row.service);
        continue;
      }
      open.frames.push(row.message);
      continue;
    }

    const exception: Exception = { head: row, frames: [] };
    exceptions.push(exception);
    openPerService.set(row.service, exception);
  }

  return exceptions;
}
