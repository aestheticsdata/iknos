import { isServerActionRequest } from "@lib/proxy/serverAction";
import { describe, expect, it } from "vitest";

const withAction = (id: string) => new Headers({ "Next-Action": id });

describe("isServerActionRequest", () => {
  it("lets through a request that calls no action", () => {
    expect(isServerActionRequest(new Headers())).toBe(false);
  });

  it("catches a well-formed id, since the front has no actions for it to match", () => {
    expect(isServerActionRequest(withAction("40c0ffee0123456789abcdef0123456789abcdef01"))).toBe(true);
  });

  it("catches the junk scanners send", () => {
    expect(isServerActionRequest(withAction("x"))).toBe(true);
    expect(isServerActionRequest(withAction(""))).toBe(true);
    expect(isServerActionRequest(withAction("$1:__proto__:then"))).toBe(true);
  });

  it("catches an id of the right length that is not hex", () => {
    expect(isServerActionRequest(withAction("z".repeat(42)))).toBe(true);
  });
});
