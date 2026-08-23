import { describe, expect, it } from "vitest";
import { readJsonColumn, safeParseJson } from "./json-column";

describe("readJsonColumn", () => {
  it("accepts both shapes the driver hands back for one column", () => {
    // The same `$queryRaw` gives an object or the text it was stored as depending on the column
    // expression. Handling only one of them is a panel where every key reads `undefined`.
    expect(readJsonColumn({ "user_agent.original": "curl/8.4.0" })).toEqual({
      "user_agent.original": "curl/8.4.0",
    });
    expect(readJsonColumn('{"user_agent.original":"curl/8.4.0"}')).toEqual({
      "user_agent.original": "curl/8.4.0",
    });
  });

  it("keeps dotted ECS keys as keys, never as a path", () => {
    const attrs = readJsonColumn('{"user_agent.original":"curl/8.4.0"}');

    expect(attrs?.["user_agent.original"]).toBe("curl/8.4.0");
    expect(attrs?.user_agent).toBeUndefined();
  });

  it("answers null for everything that is not an object of keys", () => {
    expect(readJsonColumn(null)).toBeNull();
    expect(readJsonColumn(undefined)).toBeNull();
    expect(readJsonColumn("{not json")).toBeNull();
    expect(readJsonColumn("42")).toBeNull();
    // Parses, but a lookup on it would only ever return undefined.
    expect(readJsonColumn("[1,2,3]")).toBeNull();
    expect(readJsonColumn([1, 2, 3])).toBeNull();
  });
});

describe("safeParseJson", () => {
  it("answers null rather than throwing on text that will not parse", () => {
    expect(safeParseJson("{not json")).toBeNull();
    expect(safeParseJson('{"a":1}')).toEqual({ a: 1 });
  });
});
