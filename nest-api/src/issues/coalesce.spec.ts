import { describe, expect, it } from "vitest";
import { coalesce, isContinuation } from "./coalesce";
import { errorFieldsOf, isGroupable } from "./error-fields";

import type { GroupableRow } from "./coalesce";

/**
 * The case this whole module exists for: an app that writes to stderr rather than emitting ECS.
 * One `throw` reaches `log_entry` as a header row and a dozen frame rows, every one of them
 * stamped `error` because PM2 routed the file. Grouping them separately would turn one exception
 * into thirteen issues with a count of one each — IKN-9's first acceptance criterion, inverted.
 */

let nextId = 1n;
const row = (over: Partial<GroupableRow> & { message: string }): GroupableRow => ({
  id: nextId++,
  ts: new Date("2026-08-25T02:14:37.912Z"),
  service: "pfa",
  level: 50,
  levelName: "error",
  traceId: null,
  attrs: null,
  ...over,
});

const at = (ms: number) => new Date(new Date("2026-08-25T02:14:37.912Z").getTime() + ms);

describe("isContinuation", () => {
  it("recognises indented frames and the elision tail", () => {
    expect(isContinuation("    at acquire (/app/dist/q.js:1:2)")).toBe(true);
    expect(isContinuation("    at /app/dist/q.js:1:2")).toBe(true);
    expect(isContinuation("    ... 12 more")).toBe(true);
    expect(isContinuation("Caused by: TypeError: nope")).toBe(true);
  });

  it("does not mistake an ordinary line beginning with 'at' for a frame", () => {
    // The leading whitespace is the whole distinction.
    expect(isContinuation("at capacity, shedding load")).toBe(false);
    expect(isContinuation("request completed")).toBe(false);
  });
});

describe("coalesce", () => {
  it("joins a plain-text stack into one exception", () => {
    const rows = [
      row({ message: "TypeError: cannot read 'siret' of undefined", ts: at(0) }),
      row({ message: "    at normalize (/var/www/pfa/nest-api/dist/dossiers/normalize.js:88:14)", ts: at(1) }),
      row({ message: "    at map (<anonymous>)", ts: at(1) }),
      row({ message: "    ... 12 more", ts: at(2) }),
    ];

    const [only, ...rest] = coalesce(rows);
    expect(rest).toEqual([]);
    expect(only.head.message).toBe("TypeError: cannot read 'siret' of undefined");
    expect(only.frames).toHaveLength(3);
  });

  it("keeps two interleaved services apart", () => {
    // They interleave in the table and never in a file: the head a frame joins is its own app's.
    const rows = [
      row({ message: "TypeError: a", service: "pfa", ts: at(0) }),
      row({ message: "RangeError: b", service: "zeus", ts: at(1) }),
      row({ message: "    at fromZeus (/z.js:1:1)", service: "zeus", ts: at(2) }),
      row({ message: "    at fromPfa (/p.js:1:1)", service: "pfa", ts: at(3) }),
    ];

    const [pfa, zeus] = coalesce(rows);
    expect(pfa.frames).toEqual(["    at fromPfa (/p.js:1:1)"]);
    expect(zeus.frames).toEqual(["    at fromZeus (/z.js:1:1)"]);
  });

  it("refuses to attach a frame whose header has aged out", () => {
    // A header dropped by the queue must not hand its orphaned frames to whatever came before.
    const rows = [
      row({ message: "TypeError: a", ts: at(0) }),
      row({ message: "    at late (/p.js:1:1)", ts: at(5_000) }),
    ];

    const [only] = coalesce(rows);
    expect(only.frames).toEqual([]);
    expect(coalesce(rows)).toHaveLength(1);
  });

  it("discards an orphan frame rather than promoting it to an exception", () => {
    expect(coalesce([row({ message: "    at nobody (/p.js:1:1)" })])).toEqual([]);
  });

  it("leaves an ECS line alone — one row is already one exception", () => {
    const ecs = row({
      message: "pool timeout",
      attrs: { error: { type: "ConnectionAcquireTimeoutError", stack_trace: "Error: x\n    at y (/p.js:1:1)" } },
    });
    const [only] = coalesce([ecs]);
    expect(only.frames).toEqual([]);
  });
});

describe("errorFieldsOf", () => {
  it("reads the nested ECS shape Iknos' own logger emits", () => {
    const [ex] = coalesce([
      row({
        message: "metrics scrape failed",
        attrs: {
          error: { type: "Error", message: "ECONNREFUSED", stack_trace: "Error: ECONNREFUSED\n    at f (/a.js:1:2)" },
        },
      }),
    ]);
    expect(errorFieldsOf(ex)).toEqual({
      type: "Error",
      message: "ECONNREFUSED",
      stack: "Error: ECONNREFUSED\n    at f (/a.js:1:2)",
    });
  });

  it("reads the dotted ECS shape pino's formatter emits", () => {
    // Both shapes are legal ECS and the parser already reconciles them; reading only one would
    // have quietly ignored every emitter using the other.
    const [ex] = coalesce([
      row({
        message: "boom",
        attrs: { "error.type": "RangeError", "error.stack_trace": "RangeError: boom\n    at f (/a.js:1:2)" },
      }),
    ]);
    const fields = errorFieldsOf(ex);
    expect(fields.type).toBe("RangeError");
    expect(fields.stack).toContain("at f (/a.js:1:2)");
  });

  it("splits the type off a plain-text header and rebuilds the stack", () => {
    const [ex] = coalesce([
      row({ message: "TypeError: cannot read 'siret' of undefined", ts: at(0) }),
      row({ message: "    at normalize (/var/www/pfa/nest-api/dist/dossiers/normalize.js:88:14)", ts: at(1) }),
    ]);
    const fields = errorFieldsOf(ex);

    expect(fields.type).toBe("TypeError");
    expect(fields.message).toBe("cannot read 'siret' of undefined");
    // Re-joined into V8 text form, so both paths converge on one stack parser.
    expect(fields.stack).toBe(
      "TypeError: cannot read 'siret' of undefined\n    at normalize (/var/www/pfa/nest-api/dist/dossiers/normalize.js:88:14)",
    );
  });

  it("leaves a message with no type prefix whole", () => {
    const [ex] = coalesce([row({ message: "everything is on fire" })]);
    expect(errorFieldsOf(ex)).toEqual({ type: null, message: "everything is on fire", stack: null });
  });
});

describe("isGroupable", () => {
  const judge = (r: GroupableRow) => {
    const [ex] = coalesce([r]);
    return ex === undefined ? false : isGroupable(ex, errorFieldsOf(ex));
  };

  it("accepts a real exception in either shape", () => {
    expect(judge(row({ message: "TypeError: nope\n", attrs: { error: { type: "TypeError" } } }))).toBe(true);
  });

  it("rejects a line that is merely angry", () => {
    // PM2 routes an app's whole stderr to -error.log, so `parser.ts` stamps the startup banner
    // and the retry notice `error` too. An issues list full of those is a worse log view.
    expect(judge(row({ message: "failed to connect, retrying" }))).toBe(false);
    expect(judge(row({ message: "listening on :3000" }))).toBe(false);
  });

  it("rejects anything below error, whatever it says", () => {
    expect(judge(row({ message: "TypeError: nope", level: 40, levelName: "warn" }))).toBe(false);
  });

  it("accepts a typeless error that brought frames", () => {
    const [ex] = coalesce([
      row({ message: "everything is on fire", ts: at(0) }),
      row({ message: "    at boom (/a.js:1:2)", ts: at(1) }),
    ]);
    expect(isGroupable(ex, errorFieldsOf(ex))).toBe(true);
  });
});
