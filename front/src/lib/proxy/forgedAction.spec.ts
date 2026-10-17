import { isForgedAction } from "@lib/proxy/forgedAction";
import { describe, expect, it } from "vitest";

const withAction = (id: string) => new Headers({ "Next-Action": id });

describe("isForgedAction", () => {
  it("lets through a request that calls no action", () => {
    expect(isForgedAction(new Headers())).toBe(false);
  });

  it("lets through a well-formed id, known or not", () => {
    expect(isForgedAction(withAction("40c0ffee0123456789abcdef0123456789abcdef01"))).toBe(false);
  });

  it("catches the junk scanners send", () => {
    expect(isForgedAction(withAction("x"))).toBe(true);
    expect(isForgedAction(withAction(""))).toBe(true);
    expect(isForgedAction(withAction("$1:__proto__:then"))).toBe(true);
  });

  it("catches an id of the right length that is not hex", () => {
    expect(isForgedAction(withAction("z".repeat(42)))).toBe(true);
  });
});
