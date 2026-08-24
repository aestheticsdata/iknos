import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { encodeCursor } from "./cursor";
import { parseAt, parseDir, parseRowId, resolveCursor } from "./log-query";

describe("parseDir", () => {
  it("reads the one other value as after", () => {
    expect(parseDir("after")).toBe("after");
  });

  it("defaults to before for anything else, including nothing", () => {
    expect(parseDir(undefined)).toBe("before");
    expect(parseDir("before")).toBe("before");
    expect(parseDir("AFTER")).toBe("before");
    expect(parseDir("sideways")).toBe("before");
  });
});

describe("parseAt", () => {
  it("parses an ISO instant", () => {
    expect(parseAt("2026-08-24T10:00:00.000Z")?.toISOString()).toBe("2026-08-24T10:00:00.000Z");
  });

  it("returns null rather than throwing for anything absent or unparseable", () => {
    // From a URL, same leniency as `decodeCursor`: a bad `at` means "no seed", not a 400 — the
    // query still has `from`/`to` to fall back on.
    expect(parseAt(undefined)).toBeNull();
    expect(parseAt("")).toBeNull();
    expect(parseAt("not-a-date")).toBeNull();
  });
});

describe("resolveCursor", () => {
  it("prefers a real cursor over at when both are present", () => {
    const real = encodeCursor(new Date("2026-08-24T09:00:00Z"), 42n);
    const resolved = resolveCursor({ cursor: real, at: "2026-08-24T10:00:00Z" });

    expect(resolved).toEqual({ ts: new Date("2026-08-24T09:00:00Z"), id: 42n });
  });

  it("turns at into a synthetic cursor pinned to the largest row id", () => {
    // Not the smallest: see the comment on the export itself for why both directions share the
    // same synthetic id rather than one each.
    const resolved = resolveCursor({ at: "2026-08-24T10:00:00Z" });

    expect(resolved?.ts).toEqual(new Date("2026-08-24T10:00:00Z"));
    expect(resolved?.id).toBe(18_446_744_073_709_551_615n);
  });

  it("resolves to nothing when neither cursor nor at is usable", () => {
    expect(resolveCursor({})).toBeUndefined();
    expect(resolveCursor({ at: "not-a-date" })).toBeUndefined();
    expect(resolveCursor({ cursor: "not-a-cursor" })).toBeUndefined();
  });
});

describe("parseRowId", () => {
  it("keeps every digit of an id past 2^53", () => {
    // The whole reason the id crosses the wire as a string. Through `Number` this one comes back
    // as ...992, and the route would answer confidently with the wrong line.
    expect(parseRowId("9007199254740993")).toBe(9_007_199_254_740_993n);
  });

  it("refuses anything that is not a bare decimal id", () => {
    for (const raw of ["", "12a", "1.0", "-1", "0x10", " 12", "1e3", "٣"]) {
      expect(() => parseRowId(raw)).toThrow(BadRequestException);
    }
  });

  it("refuses an id larger than the column can hold", () => {
    // A 400 rather than a bind error surfacing as a 500 on a crafted URL.
    expect(parseRowId("18446744073709551615")).toBe(18_446_744_073_709_551_615n);
    expect(() => parseRowId("18446744073709551616")).toThrow(BadRequestException);
    expect(() => parseRowId("99999999999999999999999")).toThrow(BadRequestException);
  });
});
