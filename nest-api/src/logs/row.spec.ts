import { describe, expect, it } from "vitest";
import { toLogDetail, toLogRow } from "./row";

import type { RawLogDetail, RawLogRow } from "./row";

const raw = (over: Partial<RawLogRow> = {}): RawLogRow => ({
  id: 1n,
  ts: new Date("2026-08-09T10:11:12.345Z"),
  service: "pfa-api",
  level: 30,
  levelName: "info",
  message: "hello",
  traceId: null,
  httpMethod: null,
  route: null,
  statusCode: null,
  durationMs: null,
  ...over,
});

describe("toLogRow", () => {
  it("carries an id past 2^53 without losing a digit", () => {
    // The exact failure this guards: as a JSON number, 9007199254740993 becomes ...992. Since the
    // cursor is built from the id, one rounded value silently repeats or skips a row.
    const row = toLogRow(raw({ id: 9_007_199_254_740_993n }));

    expect(row.id).toBe("9007199254740993");
    expect(typeof row.id).toBe("string");
  });

  it("survives JSON.stringify", () => {
    // A BigInt anywhere in the payload makes JSON.stringify throw outright — the first log row
    // to reach a response would 500 the route.
    expect(() => JSON.stringify(toLogRow(raw()))).not.toThrow();
  });

  it("emits the timestamp as ISO-8601 in UTC", () => {
    expect(toLogRow(raw()).ts).toBe("2026-08-09T10:11:12.345Z");
  });
});

const rawDetail = (over: Partial<RawLogDetail> = {}): RawLogDetail => ({
  ...raw(),
  clientIp: "203.0.113.7",
  userId: null,
  hostname: "ks-b",
  attrs: null,
  ...over,
});

describe("toLogDetail", () => {
  it("is the row it widens, id and timestamp included", () => {
    const detail = toLogDetail(rawDetail({ id: 9_007_199_254_740_993n }));

    // The pane and the line above it must never describe the same event differently.
    expect(detail).toMatchObject(toLogRow(raw({ id: 9_007_199_254_740_993n })));
  });

  it("carries the four columns the list leaves behind", () => {
    const detail = toLogDetail(rawDetail({ userId: "42" }));

    expect(detail.clientIp).toBe("203.0.113.7");
    expect(detail.userId).toBe("42");
    expect(detail.hostname).toBe("ks-b");
  });

  it("reads attrs whether the driver parsed them or handed back their text", () => {
    // The one behaviour that decides whether the user-agent is readable in production or is
    // `undefined` on every single line — the driver's shape for a JSON column is not a constant.
    const parsed = toLogDetail(rawDetail({ attrs: { "user_agent.original": "curl/8.4.0" } }));
    const text = toLogDetail(rawDetail({ attrs: '{"user_agent.original":"curl/8.4.0"}' }));

    expect(parsed.attrs).toEqual({ "user_agent.original": "curl/8.4.0" });
    expect(text.attrs).toEqual({ "user_agent.original": "curl/8.4.0" });
  });

  it("treats a blob that will not parse as a line with no attrs", () => {
    // Not a 500: the row is still the answer to what was asked, and the columns beside it are
    // still true.
    expect(toLogDetail(rawDetail({ attrs: "{not json" })).attrs).toBeNull();
    expect(toLogDetail(rawDetail({ attrs: null })).attrs).toBeNull();
  });

  it("survives JSON.stringify with attrs on it", () => {
    expect(() => JSON.stringify(toLogDetail(rawDetail({ attrs: { a: 1 } })))).not.toThrow();
  });
});
