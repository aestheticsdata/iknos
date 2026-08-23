import { describe, expect, it } from "vitest";
import { userAgentOf } from "./logTypes";

describe("userAgentOf", () => {
  it("reads the dotted ECS key as a key, not as a path", () => {
    // The whole point of the function existing. `attrs.user_agent.original` is `undefined` for
    // every line pino ever wrote, and nothing about an empty field says why.
    expect(userAgentOf({ "user_agent.original": "curl/8.4.0" })).toBe("curl/8.4.0");
    expect(userAgentOf({ user_agent: { original: "curl/8.4.0" } })).toBeNull();
  });

  it("treats an absent, empty or non-string agent as no agent", () => {
    // A `—` next to `agent` describes nothing that happened; the pane omits the line instead.
    expect(userAgentOf(null)).toBeNull();
    expect(userAgentOf(undefined)).toBeNull();
    expect(userAgentOf({})).toBeNull();
    expect(userAgentOf({ "user_agent.original": "" })).toBeNull();
    expect(userAgentOf({ "user_agent.original": 42 })).toBeNull();
  });
});
