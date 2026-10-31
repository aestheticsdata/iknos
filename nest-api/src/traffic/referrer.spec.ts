import { describe, expect, it } from "vitest";
import { campaignOf, DIRECT_SOURCE, refererHost, sourceName } from "./referrer";

describe("refererHost", () => {
  it("lowercases and strips www", () => {
    expect(refererHost("https://www.Google.com/")).toBe("google.com");
    expect(refererHost("http://news.ycombinator.com/item?id=1")).toBe("news.ycombinator.com");
  });

  it.each(["-", "", "android-app://com.slack", "not a url"])("answers null for %j", (value) => {
    expect(refererHost(value)).toBeNull();
  });

  it("answers null for a bare address or localhost, which can be the reader's own network", () => {
    expect(refererHost("http://192.168.1.20:3000/")).toBeNull();
    expect(refererHost("http://[::1]/")).toBeNull();
    expect(refererHost("http://localhost:3016/chapter/1")).toBeNull();
  });

  it("answers null for nothing", () => {
    expect(refererHost(null)).toBeNull();
  });
});

describe("sourceName", () => {
  it.each([
    ["google.fr", "Google"],
    ["google.com", "Google"],
    ["t.co", "X"],
    ["lnkd.in", "LinkedIn"],
    ["news.ycombinator.com", "Hacker News"],
    ["bsky.app", "Bluesky"],
    ["example.org", "example.org"],
  ])("maps %s to %s", (host, name) => {
    expect(sourceName(host)).toBe(name);
  });

  it("names the absence of a referrer", () => {
    expect(sourceName(null)).toBe(DIRECT_SOURCE);
    expect(DIRECT_SOURCE).toBe("Direct or unknown");
  });
});

describe("campaignOf", () => {
  it("reads the three utm tags", () => {
    expect(campaignOf("utm_source=newsletter&utm_medium=email&utm_campaign=oct")).toEqual({
      source: "newsletter",
      medium: "email",
      campaign: "oct",
    });
  });

  it("reads ref= as the source when utm_source is absent", () => {
    expect(campaignOf("ref=producthunt")).toEqual({ source: "producthunt", medium: null, campaign: null });
  });

  it("answers null for a query without a campaign", () => {
    expect(campaignOf("page=2")).toBeNull();
    expect(campaignOf(null)).toBeNull();
  });
});
