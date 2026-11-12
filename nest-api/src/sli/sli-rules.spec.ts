import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { ingestedThrough, likeSubtree, p95Offset, toSliQuery } from "./sli-rules";

const FROM = "2026-11-12T10:00:00.000Z";
const TO = "2026-11-12T10:30:00.000Z";

describe("toSliQuery", () => {
  it("reads a complete query", () => {
    const q = toSliQuery({ service: "atlas-front", from: FROM, to: TO, pathPrefix: "/api/" });
    expect(q).toEqual({
      service: "atlas-front",
      from: new Date(FROM),
      to: new Date(TO),
      pathPrefix: "/api",
      excludePathPrefix: null,
    });
  });

  it("treats an empty prefix as no prefix", () => {
    const q = toSliQuery({ service: "atlas-front", from: FROM, to: TO, pathPrefix: "", excludePathPrefix: "" });
    expect(q.pathPrefix).toBeNull();
    expect(q.excludePathPrefix).toBeNull();
  });

  it("requires a service and a window", () => {
    expect(() => toSliQuery({ from: FROM, to: TO })).toThrow(BadRequestException);
    expect(() => toSliQuery({ service: "atlas-front", from: FROM })).toThrow(BadRequestException);
    expect(() => toSliQuery({ service: "atlas-front", from: TO, to: FROM })).toThrow(BadRequestException);
  });

  it("refuses a window longer than a day", () => {
    expect(() => toSliQuery({ service: "atlas-front", from: "2026-11-10T00:00:00Z", to: TO })).toThrow(/24 hours/);
  });

  it("refuses a prefix that is not a path, and the bare root", () => {
    expect(() => toSliQuery({ service: "atlas-front", from: FROM, to: TO, pathPrefix: "api" })).toThrow(/path/);
    expect(() => toSliQuery({ service: "atlas-front", from: FROM, to: TO, pathPrefix: "/a%" })).toThrow(/path/);
    expect(() => toSliQuery({ service: "atlas-front", from: FROM, to: TO, pathPrefix: "/" })).toThrow(/leave it out/);
  });

  it("refuses including and excluding the same subtree", () => {
    expect(() =>
      toSliQuery({ service: "atlas-front", from: FROM, to: TO, pathPrefix: "/api", excludePathPrefix: "/api/" }),
    ).toThrow(/cancel/);
  });
});

describe("likeSubtree", () => {
  it("matches below the prefix, never a sibling that merely starts the same", () => {
    // `/api/%` — `/apiary` does not match it; `/api` itself is matched by equality beside it.
    expect(likeSubtree("/api")).toBe("/api/%");
  });

  it("takes an underscore literally", () => {
    expect(likeSubtree("/_next")).toBe("/\\_next/%");
  });
});

describe("p95Offset", () => {
  it("is nothing to rank on an empty window", () => {
    expect(p95Offset(0)).toBeNull();
  });

  it("is the nearest rank, counted from zero", () => {
    // 1 value: itself. 20 values: the 19th. 100 values: the 95th. 101 values: the 96th.
    expect(p95Offset(1)).toBe(0);
    expect(p95Offset(20)).toBe(18);
    expect(p95Offset(100)).toBe(94);
    expect(p95Offset(101)).toBe(95);
  });
});

describe("ingestedThrough", () => {
  const poll = new Date("2026-11-12T10:30:05Z");
  const write = new Date("2026-11-12T10:30:02Z");

  it("is the last pass when nothing is waiting to be written", () => {
    expect(ingestedThrough({ lastPollAt: poll, lastWrittenAt: write, queued: 0 })).toEqual(poll);
  });

  it("is the last commit while lines are still queued", () => {
    expect(ingestedThrough({ lastPollAt: poll, lastWrittenAt: write, queued: 12 })).toEqual(write);
  });

  it("vouches for nothing before the first pass, or with lines queued and none ever written", () => {
    expect(ingestedThrough({ lastPollAt: null, lastWrittenAt: null, queued: 0 })).toBeNull();
    expect(ingestedThrough({ lastPollAt: poll, lastWrittenAt: null, queued: 3 })).toBeNull();
  });
});
