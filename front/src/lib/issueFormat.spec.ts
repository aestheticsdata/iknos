import { describe, expect, it } from "vitest";
import { formatAgo, formatRelease, isHot, issueLine, issueTitle, recencyTone, shortFingerprint } from "./issueFormat";

import type { IssueRow } from "./issueTypes";

/**
 * The four things on an issue row that are computed rather than served, and every one of them is
 * read as a fact: how recent it is, how long ago that was, what to call it, and where it happened.
 */

const NOW = Date.UTC(2026, 7, 25, 14, 0, 0);
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const row = (over: Partial<IssueRow> = {}): IssueRow => ({
  fingerprint: "4f2ab91c9c0e17d4",
  service: "pfa",
  type: "ConnectionAcquireTimeoutError",
  message: "pool timeout after 8000ms",
  culprit: "acquire (dist/queue/export.js:142)",
  level: 50,
  levelName: "error",
  status: "unresolved",
  regression: false,
  firstSeen: ago(30 * DAY),
  lastSeen: ago(2 * MINUTE),
  eventCount: 1_204,
  firstRelease: null,
  lastRelease: null,
  spark: [],
  ...over,
});

describe("recencyTone", () => {
  it("walks the four tiers by how recently the error was last seen", () => {
    expect(recencyTone(ago(2 * MINUTE), NOW)).toBe("error");
    expect(recencyTone(ago(30 * MINUTE), NOW)).toBe("warn");
    expect(recencyTone(ago(6 * HOUR), NOW)).toBe("info");
    expect(recencyTone(ago(3 * DAY), NOW)).toBe("ok");
  });

  it("puts each boundary in the calmer tier", () => {
    // Exactly fifteen minutes old is no longer "happening now" — the tiers are half-open, and the
    // one that claims least wins a tie.
    expect(recencyTone(ago(15 * MINUTE), NOW)).toBe("warn");
    expect(recencyTone(ago(HOUR), NOW)).toBe("info");
    expect(recencyTone(ago(DAY), NOW)).toBe("ok");
  });

  it("treats an unreadable timestamp as cold rather than as fresh", () => {
    expect(recencyTone("not a date", NOW)).toBe("ok");
  });

  it("agrees with the row's hot ground, so a dot and a background cannot disagree", () => {
    expect(isHot(row({ lastSeen: ago(MINUTE) }), NOW)).toBe(true);
    expect(isHot(row({ lastSeen: ago(20 * MINUTE) }), NOW)).toBe(false);
  });
});

describe("formatAgo", () => {
  it("uses one unit, and never seconds", () => {
    expect(formatAgo(ago(4_000), NOW)).toBe("now");
    expect(formatAgo(ago(2 * MINUTE), NOW)).toBe("2m ago");
    expect(formatAgo(ago(14 * MINUTE), NOW)).toBe("14m ago");
    expect(formatAgo(ago(6 * HOUR), NOW)).toBe("6h ago");
    expect(formatAgo(ago(5 * DAY), NOW)).toBe("5d ago");
  });

  it("clamps a timestamp from the future rather than reporting a negative age", () => {
    expect(formatAgo(new Date(NOW + HOUR).toISOString(), NOW)).toBe("now");
  });

  it("dashes an unreadable timestamp", () => {
    expect(formatAgo("whenever", NOW)).toBe("—");
  });
});

describe("the row's words", () => {
  it("joins the message to where it happened", () => {
    expect(issueLine(row())).toBe("pool timeout after 8000ms · acquire (dist/queue/export.js:142)");
  });

  it("omits the separator when every frame belonged to a dependency", () => {
    // A trailing ` · ` with nothing after it reads as a rendering fault.
    expect(issueLine(row({ culprit: null }))).toBe("pool timeout after 8000ms");
  });

  it("keeps a multi-line message to its first line", () => {
    // A serialised error can arrive as its whole stack; the rest belongs in the modal.
    expect(issueLine(row({ message: "boom\n    at f (a.js:1:1)", culprit: null }))).toBe("boom");
  });

  it("falls back to the message when the exception carried no type", () => {
    expect(issueTitle(row({ type: null, message: "segmentation fault" }))).toBe("segmentation fault");
  });

  it("shortens the fingerprint to the eight characters the row prints", () => {
    expect(shortFingerprint("4f2ab91c9c0e17d4")).toBe("4f2ab91c");
  });

  it("dashes a release nobody has written yet, rather than dropping the column", () => {
    expect(formatRelease(null)).toBe("—");
    expect(formatRelease("release-20260825-main-a41c9e2")).toBe("release-20260825-main-a41c9e2");
  });
});
