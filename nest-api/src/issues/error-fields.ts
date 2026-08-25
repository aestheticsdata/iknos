import { lookup } from "@ingest/parser";
import { isContinuation } from "./coalesce";

import type { Exception } from "./coalesce";

/**
 * The three things a fingerprint is built from, pulled out of an exception however it arrived
 * (IKN-9).
 *
 * There are two shapes to read, and the spec that designed this named neither — which is the gap
 * that made this its own module with its own tests rather than four lines inside the grouper.
 *
 * **ECS.** `error.*` is not in the parser's `PROMOTED` list, so an instrumented app's error type
 * and stack survive inside `attrs` rather than as columns. They arrive dotted (`"error.type"`,
 * what pino's ECS formatter emits) or nested (`{error: {type}}`, what Iknos' own logger emits) —
 * both are legal ECS and `parser.ts` already reconciles them, so this reads through the same
 * `lookup` rather than a second guess at the same question. Reading only one shape would have
 * silently ignored every emitter using the other, and been right often enough not to notice.
 *
 * **Plain text.** An uninstrumented app writes `TypeError: cannot read 'siret' of undefined` and
 * a dozen indented frames. The header carries the type before the first colon, and `coalesce`
 * has already gathered the frames.
 */

export type ErrorFields = {
  type: string | null;
  /** The message alone — the type prefix stripped when it was a plain-text header. */
  message: string;
  /** A stack in V8 text form, or null when the exception carried no frames at all. */
  stack: string | null;
};

/** `TypeError: cannot read …` → the type and the rest. Anything else has no type. */
const HEADER = /^([A-Za-z_$][\w$]*(?:Error|Exception|Warning))\s*:\s*([\s\S]*)$/;

const asString = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

/**
 * ECS puts the stack under `error.stack_trace`; some loggers write `error.stack`. Both are read,
 * the spec-correct one first — a logger emitting both is emitting the same thing twice.
 */
const stackFromAttrs = (attrs: Record<string, unknown>): string | null =>
  asString(lookup(attrs, "error.stack_trace")) ?? asString(lookup(attrs, "error.stack"));

export function errorFieldsOf(exception: Exception): ErrorFields {
  const { head, frames } = exception;
  const attrs = head.attrs;

  if (attrs !== null) {
    const ecsStack = stackFromAttrs(attrs);
    const ecsType = asString(lookup(attrs, "error.type"));

    if (ecsStack !== null || ecsType !== null) {
      return {
        type: ecsType,
        // The ECS `message` is the log message, which for a serialised error is already the
        // error's own message. `error.message` wins when both are there and they differ: it is
        // the error speaking rather than the line that reported it.
        message: asString(lookup(attrs, "error.message")) ?? head.message,
        stack: ecsStack,
      };
    }
  }

  // Plain text. The header line is the message and possibly the type; `coalesce` collected the
  // frames, and they are re-joined into the V8 text form `normaliseFrames` already reads, so the
  // two paths converge on one parser rather than two.
  const match = HEADER.exec(head.message);
  const type = match ? match[1] : null;
  const message = match ? match[2] : head.message;

  return {
    type,
    message,
    stack: frames.length > 0 ? [head.message, ...frames].join("\n") : null,
  };
}

/**
 * Whether an exception is worth grouping at all.
 *
 * **The predicate the design forgot.** The grouper reads a window of rows and every one of them
 * has to be judged, because `parser.ts` stamps *everything* PM2 routed to `-error.log` as an
 * error — including an app's startup banner, a deprecation notice, and a progress bar. Three
 * tests, cheapest first:
 *
 * - it is at least `error` on pino's scale, which is what "an error" means everywhere else here;
 * - it is not itself a continuation line, which `coalesce` would have consumed if it had a head
 *   and which is half of nothing if it did not;
 * - it names an error type, or it carries frames. A line that is merely angry — `failed to
 *   connect, retrying` — is a log line, and an issues list that fills up with those is a second
 *   log view with worse ergonomics.
 */
export const ERROR_LEVEL = 50;

export function isGroupable(exception: Exception, fields: ErrorFields): boolean {
  if (exception.head.level < ERROR_LEVEL) return false;
  if (isContinuation(exception.head.message)) return false;
  return fields.type !== null || fields.stack !== null;
}
