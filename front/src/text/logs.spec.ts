import { describe, expect, it } from "vitest";
import { LOGS_TEXT } from "./logs";

/**
 * The two labels that name a time zone, and the one rule they both have to obey.
 *
 * Written as a guard rather than driven out test-first: the behaviour was designed into the labels
 * when IKN-38 was built. It is here because the invariant is invisible at the call site and cheap
 * to break — `columns.time` is rendered inside a `<th>` that really is server-rendered, unlike the
 * rows, and the server has no way to know the reader's zone. Anything but a zone-less string for
 * `null` puts a different word in the HTML than in the first client paint, which is a hydration
 * mismatch logged on every page load.
 */
describe("the pre-mount label names no zone", () => {
  it("heads the time column with a bare word before the zone is known", () => {
    expect(LOGS_TEXT.columns.time(null)).toBe("time");
  });

  it("heads the raw event pane with a bare word before the zone is known", () => {
    expect(LOGS_TEXT.rawEvent(null)).toBe("event");
  });
});

describe("once the zone is known", () => {
  it("says which one, in the panel's lowercase", () => {
    expect(LOGS_TEXT.columns.time("CEST")).toBe("time · cest");
  });

  it("marks the raw event as UTC only when the column disagrees with it", () => {
    expect(LOGS_TEXT.rawEvent("CEST")).toBe("event · utc");
    expect(LOGS_TEXT.rawEvent("UTC")).toBe("event");
  });
});
