/**
 * Column bounds for the issues tables, enforced at the writing edge (IKN-9).
 *
 * **The grouper is the second writing edge, and it did not inherit the first one's law.**
 * `writer.ts:33-40` states it: MySQL in strict mode fails the whole INSERT on overflow, so one
 * malformed line becomes an outage for everything sharing its batch. The writer clamps every
 * column for that reason — every column but `attrs`, which is JSON and has no bound worth
 * enforcing there.
 *
 * `error.type`, `error.message` and `error.stack_trace` live *inside* `attrs`. They are never
 * promoted to a column, so they reach `log_entry` unclamped by design, and the grouper then reads
 * them back out and writes them into `VARCHAR(255)` and `TEXT`. A single app throwing
 * `new Error(\`upstream ${status}: ${await res.text()}\`)` against a service that answers with an
 * HTML error page produces an `error.message` past 64 KB, and MySQL error 1406 takes the whole
 * pass down with it — silently, because `tick()` swallows it.
 *
 * So the same law, applied at the second edge. Clamped, the only failures left here are
 * connectivity, which are the ones safe to retry.
 */

/** `issue.message` and `issue_event.message`/`stack` are TEXT — 65,535 **bytes**, not characters. */
const MAX_TEXT_BYTES = 60_000;

/** `issue.type` and `issue.culprit`. */
export const MAX_TYPE = 255;
export const MAX_CULPRIT = 255;
/** `issue.service` and `issue.level_name`, mirroring `log_entry`'s own widths. */
export const MAX_SERVICE = 64;
export const MAX_LEVEL_NAME = 16;
/** `issue_event.trace_id` is CHAR(32); `release_tag` is VARCHAR(64). */
export const MAX_TRACE_ID = 32;
export const MAX_RELEASE_TAG = 64;

/** Character clamp, for the VARCHARs. */
export const clamp = <T extends string | null>(value: T, max: number): T =>
  value !== null && value.length > max ? (value.slice(0, max) as T) : value;

/**
 * Byte clamp, for the TEXT columns.
 *
 * TEXT is bounded in bytes and a stack trace is full of paths that are not ASCII everywhere, so a
 * character count would let a 64,000-character message overflow a 65,535-byte column. Cut on
 * bytes, then drop the replacement character a mid-codepoint cut leaves behind — the same two
 * steps `clampMessage` takes in the writer.
 */
export function clampText<T extends string | null>(value: T, max: number = MAX_TEXT_BYTES): T {
  if (value === null || Buffer.byteLength(value) <= max) return value;
  return Buffer.from(value).subarray(0, max).toString("utf8").replace(/�+$/, "") as T;
}
