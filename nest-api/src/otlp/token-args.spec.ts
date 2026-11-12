import { describe, expect, it } from "vitest";
import { parseCreateArgs, parseTokenId } from "./token-args";

describe("parseCreateArgs", () => {
  it("reads a service, its origins and a label", () => {
    expect(
      parseCreateArgs([
        "opifex-front",
        "--origin",
        "https://opifex.1991computer.com",
        "--origin",
        "http://localhost:4600",
        "--label",
        "opifex prod",
      ]),
    ).toEqual({
      service: "opifex-front",
      origins: ["https://opifex.1991computer.com", "http://localhost:4600"],
      label: "opifex prod",
    });
  });

  it("allows no origin at all — a server-side sender", () => {
    expect(parseCreateArgs(["vidar-front"])).toEqual({ service: "vidar-front", origins: [], label: null });
  });

  it("normalises and de-duplicates origins", () => {
    expect(parseCreateArgs(["x", "--origin", "https://A.test", "--origin", "https://a.test"]).origins).toEqual([
      "https://a.test",
    ]);
  });

  it("refuses an origin a browser would never send, with the fix in the message", () => {
    expect(() => parseCreateArgs(["x", "--origin", "https://a.test/"])).toThrow(/scheme and host only/);
  });

  it("refuses a missing service, a second service, a dangling flag and an unknown flag", () => {
    expect(() => parseCreateArgs(["--origin", "https://a.test"])).toThrow(/which service/);
    expect(() => parseCreateArgs(["a", "b"])).toThrow(/one service per token/);
    expect(() => parseCreateArgs(["a", "--origin"])).toThrow(/needs a value/);
    expect(() => parseCreateArgs(["a", "--force"])).toThrow(/unknown option/);
  });
});

describe("parseTokenId", () => {
  it("reads one positive id and nothing else", () => {
    expect(parseTokenId(["3"])).toBe(3);
    expect(() => parseTokenId([])).toThrow();
    expect(() => parseTokenId(["0"])).toThrow();
    expect(() => parseTokenId(["3", "4"])).toThrow();
  });
});
