import { COALESCE_WINDOW_MS, coalesce } from "./coalesce";
import { ERROR_LEVEL, errorFieldsOf, isGroupable } from "./error-fields";
import { fingerprintOf } from "./fingerprint";

import type { Exception, GroupableRow } from "./coalesce";

/**
 * Which issue a given log line ended up in — the other direction of the round trip (IKN-14, `⌘I`).
 *
 * The modal already goes from an issue to the logs of the request that produced it. This is the
 * way back: a reader scrolling the log list stops on a stack trace and asks "how often does *this*
 * happen", which is the question the issues table exists to answer and which is otherwise reached
 * by copying an error type into a search.
 *
 * **It re-runs the grouper's own pipeline rather than storing a link.** `issue_event` could have
 * carried the `log_entry.id` it came from, and the collector cannot supply one: `persistBatch`
 * writes through `createMany` inside a transaction, which returns no generated ids on MySQL. So
 * the mapping is recomputed — through the same `coalesce`, the same `errorFieldsOf`, the same
 * `fingerprintOf` the grouper used — which is the only version of it that cannot drift from what
 * the grouping actually did.
 *
 * Pure, and separate from the service for that reason: everything interesting here is about
 * picking the right exception out of a window, and it is tested without a database.
 */

/**
 * How far either side of the line to read.
 *
 * A continuation frame needs the header **above** it, and a header needs the frames **below** it,
 * so the window opens in both directions — by exactly the span `coalesce` is willing to join
 * across, because a row further away than that would not have been joined by the grouper either.
 */
export const LOOKAROUND_MS = COALESCE_WINDOW_MS;

/**
 * The exception a row belongs to, out of the window it was read with.
 *
 * Two cases, and they are the two shapes an exception arrives in. An ECS line — or the header of a
 * plain-text stack — *is* the head of its exception, so it is found by id. A `    at …` frame is
 * not a head at all and was never returned as one: it belongs to the most recent head before it,
 * which is the same rule `coalesce` applied when it swallowed the frame in the first place.
 */
export function exceptionFor(rows: GroupableRow[], id: bigint): Exception | null {
  const exceptions = coalesce(rows);

  const own = exceptions.find((one) => one.head.id === id);
  if (own !== undefined) return own;

  // The row is a frame. Its head is the last one before it — `findLast` over an array `coalesce`
  // returned in `(ts, id)` order, which is the order it was given.
  const target = rows.find((row) => row.id === id);
  if (target === undefined) return null;

  const before = exceptions.filter((one) => one.head.ts <= target.ts && one.head.id < id);
  return before.at(-1) ?? null;
}

/**
 * The fingerprint of the issue a log line was grouped into, or null.
 *
 * Null rather than a throw for every "there is no issue here" — a line below `error`, an angry
 * sentence with no type and no stack, an orphan frame whose header aged out of the file. None of
 * them is a failure; they are all the honest answer that this particular line is not an exception.
 */
export function fingerprintForLog(rows: GroupableRow[], id: bigint): string | null {
  const target = rows.find((row) => row.id === id);
  if (target === undefined || target.level < ERROR_LEVEL) return null;

  const exception = exceptionFor(rows, id);
  if (exception === null) return null;

  const fields = errorFieldsOf(exception);
  if (!isGroupable(exception, fields)) return null;

  return fingerprintOf({
    service: exception.head.service,
    type: fields.type,
    stack: fields.stack,
    message: fields.message,
  });
}
