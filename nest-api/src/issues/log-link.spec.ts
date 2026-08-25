import { describe, expect, it } from "vitest";
import { fingerprintOf } from "./fingerprint";
import { exceptionFor, fingerprintForLog } from "./log-link";

import type { GroupableRow } from "./coalesce";

/**
 * `⌘I` — from a log line to the issue it was grouped into (IKN-14).
 *
 * The claim under test is stronger than "it returns a fingerprint": it must return the **same**
 * fingerprint the grouper wrote, from a line the reader picked rather than from the exception the
 * grouper happened to assemble. So the assertions compare against `fingerprintOf` directly, and
 * every shape a stack arrives in is exercised — the ECS line, the plain-text header, and a frame
 * halfway down a stack, which is the row a reader is most likely to have their cursor on.
 */

const BASE = Date.UTC(2026, 7, 25, 2, 14, 0);

const row = (id: number, message: string, ms = 0, attrs: Record<string, unknown> | null = null): GroupableRow => ({
  id: BigInt(id),
  ts: new Date(BASE + ms),
  service: "pfa",
  level: 50,
  levelName: "error",
  message,
  traceId: null,
  attrs,
});

const STACK = "ConnectionAcquireTimeoutError: pool timeout\n    at acquire (/var/www/pfa/nest-api/dist/q.js:142:15)";

const ecs = (id: number, ms = 0) =>
  row(id, "pool timeout", ms, {
    error: { type: "ConnectionAcquireTimeoutError", message: "pool timeout", stack_trace: STACK },
  });

/** The plain-text form of one throw: a header and two frames, as PM2 hands them over. */
const TEXT = [
  row(10, "TypeError: cannot read 'siret' of undefined", 0),
  row(11, "    at normalize (/var/www/pfa/nest-api/dist/dossiers/normalize.js:88:14)", 1),
  row(12, "    at map (<anonymous>)", 2),
];

describe("exceptionFor", () => {
  it("finds the exception a header row heads", () => {
    expect(exceptionFor(TEXT, 10n)?.head.id).toBe(10n);
  });

  it("gives a frame the header above it, which is where its identity lives", () => {
    // The row a reader's cursor is on is as likely to be a frame as a header, and a frame on its
    // own is half of something — `coalesce` discards it rather than promoting it.
    expect(exceptionFor(TEXT, 11n)?.head.id).toBe(10n);
    expect(exceptionFor(TEXT, 12n)?.head.id).toBe(10n);
  });

  it("does not attach a frame to an exception it never belonged to", () => {
    // Two throws in one window: the second stack's frames must not resolve to the first header.
    const rows = [...TEXT, row(20, "RangeError: boom", 5), row(21, "    at render (/var/www/pfa/x.js:1:1)", 6)];
    expect(exceptionFor(rows, 21n)?.head.id).toBe(20n);
  });

  it("answers null for a row that is not in the window at all", () => {
    expect(exceptionFor(TEXT, 999n)).toBeNull();
  });
});

describe("fingerprintForLog", () => {
  it("agrees with the fingerprint the grouper wrote, for an ECS line", () => {
    const expected = fingerprintOf({
      service: "pfa",
      type: "ConnectionAcquireTimeoutError",
      stack: STACK,
      message: "pool timeout",
    });

    expect(fingerprintForLog([ecs(1)], 1n)).toBe(expected);
  });

  it("gives every row of one plain-text stack the same answer", () => {
    const head = fingerprintForLog(TEXT, 10n);

    expect(head).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprintForLog(TEXT, 11n)).toBe(head);
    expect(fingerprintForLog(TEXT, 12n)).toBe(head);
  });

  it("has no answer for a line that is merely angry", () => {
    // No type, no stack — it was never grouped, so there is no issue to open.
    expect(fingerprintForLog([row(1, "failed to connect, retrying")], 1n)).toBeNull();
  });

  it("has no answer below error level", () => {
    const warn = { ...row(1, "TypeError: something"), level: 40, levelName: "warn" };
    expect(fingerprintForLog([warn], 1n)).toBeNull();
  });

  it("has no answer for a frame whose header is not in the window", () => {
    // The header aged out of the file, or the reader jumped into the middle of a stack at the very
    // edge of the range. Half an exception is not an issue.
    expect(fingerprintForLog([TEXT[1], TEXT[2]], 11n)).toBeNull();
  });
});
