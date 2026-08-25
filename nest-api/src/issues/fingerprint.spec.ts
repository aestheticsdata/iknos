import { describe, expect, it } from "vitest";
import { culpritOf, fingerprintOf, normaliseFrames, normaliseMessage, normalisePath } from "./fingerprint";

/**
 * The fingerprint is an issue's identity in `issue.fingerprint` (IKN-9). Errors thrown months
 * apart must land on the same sixteen characters, or the counter that says "this has happened
 * 1 204 times" is really several counters nobody can add up.
 *
 * These pin behaviour rather than exact digests: the digest is an implementation detail, but
 * every equality and inequality below is a promise IKN-9's acceptance criteria make out loud.
 */

const stack = (...frames: string[]) => ["ConnectionAcquireTimeoutError: pool timeout", ...frames].join("\n");

const LIVE = "    at acquire (/var/www/pfa/nest-api/dist/queue/export.js:142:15)";
const STAGED =
  "    at acquire (/var/www/pfa/nest-api-releases/release-20260825-main-a41c9e2/dist/queue/export.js:142:15)";
const ROLLED_BACK = "    at acquire (/var/www/pfa/nest-api.bak/dist/queue/export.js:142:15)";

describe("normalisePath", () => {
  it("reduces a live deploy path to its project-relative form", () => {
    expect(normalisePath("/var/www/pfa/nest-api/dist/queue/export.js")).toBe("dist/queue/export.js");
  });

  it("reduces the staged release and the rollback copy to the same form", () => {
    const live = normalisePath("/var/www/pfa/nest-api/dist/queue/export.js");
    expect(normalisePath("/var/www/pfa/nest-api-releases/release-20260825-main-a41c9e2/dist/queue/export.js")).toBe(
      live,
    );
    expect(normalisePath("/var/www/pfa/nest-api.bak/dist/queue/export.js")).toBe(live);
  });

  it("cuts a dependency at the last node_modules, so hoisting does not matter", () => {
    expect(normalisePath("/var/www/pfa/nest-api/node_modules/mariadb/lib/pool.js")).toBe(
      "node_modules/mariadb/lib/pool.js",
    );
    expect(normalisePath("/home/me/dev/pfa/node_modules/.pnpm/x@1/node_modules/mariadb/lib/pool.js")).toBe(
      "node_modules/mariadb/lib/pool.js",
    );
  });

  it("strips the file:// an ESM stack carries", () => {
    expect(normalisePath("file:///var/www/pfa/nest-api/dist/queue/export.js")).toBe("dist/queue/export.js");
  });

  it("leaves a path it does not recognise alone", () => {
    // Better an unreduced path than a wrong one: an unfamiliar layout still groups with itself.
    expect(normalisePath("/opt/something/else.js")).toBe("/opt/something/else.js");
  });
});

describe("normaliseFrames", () => {
  it("drops the Error: message header and keeps locations only", () => {
    expect(normaliseFrames(stack(LIVE))).toEqual(["acquire (dist/queue/export.js:142)"]);
  });

  it("keeps the line of our own frames and drops the column", () => {
    // A formatter moving a statement sideways is not a new bug.
    const moved = "    at acquire (/var/www/pfa/nest-api/dist/queue/export.js:142:98)";
    expect(normaliseFrames(stack(moved))).toEqual(normaliseFrames(stack(LIVE)));
  });

  it("drops line and column from node_modules frames entirely", () => {
    const before = "    at Pool.acquire (/var/www/pfa/nest-api/node_modules/mariadb/lib/pool.js:210:11)";
    const afterBump = "    at Pool.acquire (/var/www/pfa/nest-api/node_modules/mariadb/lib/pool.js:298:11)";
    expect(normaliseFrames(stack(afterBump))).toEqual(normaliseFrames(stack(before)));
    expect(normaliseFrames(stack(before))).toEqual(["Pool.acquire (node_modules/mariadb/lib/pool.js)"]);
  });

  it("separates two throws from one file and line but different functions", () => {
    const a = "    at acquire (/var/www/pfa/nest-api/dist/q.js:10:1)";
    const b = "    at release (/var/www/pfa/nest-api/dist/q.js:10:1)";
    expect(normaliseFrames(stack(a))).not.toEqual(normaliseFrames(stack(b)));
  });

  it("reads a bare frame with no function name", () => {
    expect(normaliseFrames(stack("    at /var/www/pfa/nest-api/dist/q.js:10:1)"))).toEqual(["dist/q.js:10"]);
  });

  it("stops at the configured depth", () => {
    const deep = Array.from({ length: 20 }, (_, i) => `    at f${i} (/var/www/pfa/nest-api/dist/q.js:${i}:1)`);
    expect(normaliseFrames(stack(...deep), 3)).toHaveLength(3);
    expect(normaliseFrames(stack(...deep))).toHaveLength(5);
  });

  it("returns nothing for an absent or unparseable stack", () => {
    expect(normaliseFrames(null)).toEqual([]);
    expect(normaliseFrames("")).toEqual([]);
    expect(normaliseFrames("something that is not a stack at all")).toEqual([]);
  });
});

describe("normaliseMessage", () => {
  it("blanks the number that varies per occurrence", () => {
    expect(normaliseMessage("pool timeout after 8000ms")).toBe(normaliseMessage("pool timeout after 8001ms"));
  });

  it("blanks uuids and long hex identifiers", () => {
    expect(normaliseMessage("no row for 3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBe("no row for <uuid>");
    expect(normaliseMessage("trace 4f2ab91c9c0e17d4 not found")).toBe("trace <hex> not found");
  });

  it("does not eat an ordinary word", () => {
    expect(normaliseMessage("the decade was quiet")).toBe("the decade was quiet");
  });
});

describe("culpritOf", () => {
  it("is the first frame that is ours", () => {
    const frames = normaliseFrames(
      stack("    at Pool.acquire (/var/www/pfa/nest-api/node_modules/mariadb/lib/pool.js:210:11)", LIVE),
    );
    expect(culpritOf(frames)).toBe("acquire (dist/queue/export.js:142)");
  });

  it("is null when every frame belongs to a dependency", () => {
    // Naming the library says nothing the error type did not already say.
    const frames = normaliseFrames(stack("    at x (/var/www/pfa/nest-api/node_modules/mariadb/lib/pool.js:1:1)"));
    expect(culpritOf(frames)).toBeNull();
  });
});

describe("fingerprintOf", () => {
  const input = { service: "pfa", type: "ConnectionAcquireTimeoutError", message: "pool timeout after 8000ms" };

  it("is sixteen hex characters", () => {
    expect(fingerprintOf({ ...input, stack: stack(LIVE) })).toMatch(/^[0-9a-f]{16}$/);
  });

  it("gives one identity to a hundred identical throws", () => {
    const one = fingerprintOf({ ...input, stack: stack(LIVE) });
    for (let i = 0; i < 100; i += 1) {
      expect(fingerprintOf({ ...input, stack: stack(LIVE) })).toBe(one);
    }
  });

  it("survives a deployment — live, staged and rolled-back paths are one issue", () => {
    const live = fingerprintOf({ ...input, stack: stack(LIVE) });
    expect(fingerprintOf({ ...input, stack: stack(STAGED) })).toBe(live);
    expect(fingerprintOf({ ...input, stack: stack(ROLLED_BACK) })).toBe(live);
  });

  it("keeps two different stacks of the same type apart", () => {
    const other = "    at render (/var/www/pfa/nest-api/dist/pdf/render.js:204:9)";
    expect(fingerprintOf({ ...input, stack: stack(other) })).not.toBe(fingerprintOf({ ...input, stack: stack(LIVE) }));
  });

  it("keeps the same stack in two services apart", () => {
    // Cross-service grouping is explicitly out of scope: one team's pool timeout is not another's.
    expect(fingerprintOf({ ...input, service: "zeus", stack: stack(LIVE) })).not.toBe(
      fingerprintOf({ ...input, stack: stack(LIVE) }),
    );
  });

  it("keeps two error types with one stack apart", () => {
    expect(fingerprintOf({ ...input, type: "RangeError", stack: stack(LIVE) })).not.toBe(
      fingerprintOf({ ...input, stack: stack(LIVE) }),
    );
  });

  it("falls back to the normalised message when there is no stack", () => {
    const a = fingerprintOf({ ...input, stack: null, message: "pool timeout after 8000ms" });
    const b = fingerprintOf({ ...input, stack: null, message: "pool timeout after 9999ms" });
    expect(a).toBe(b);
  });

  it("cannot collide a message fallback with a stack of the same text", () => {
    // The `s`/`m` marker exists for exactly this: without it, a message that reads like a frame
    // list would hash over the same parts as a real stack.
    const frames = normaliseFrames(stack(LIVE)).join("\0");
    expect(fingerprintOf({ ...input, stack: null, message: frames })).not.toBe(
      fingerprintOf({ ...input, stack: stack(LIVE) }),
    );
  });

  it("treats an unparseable stack as no stack, not as an empty one", () => {
    const noise = fingerprintOf({ ...input, stack: "not a stack" });
    expect(noise).toBe(fingerprintOf({ ...input, stack: null }));
  });
});
