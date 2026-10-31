import { describe, expect, it } from "vitest";
import { botName, isProbePath, KIND, requestKind } from "./classify";

const CHROME_DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

describe("isProbePath", () => {
  it.each([
    "/wp-login.php",
    "/.env",
    "/.git/config",
    "/xmlrpc.php",
    "/phpmyadmin/",
    "/cgi-bin/x",
    "/index.php",
    "/vendor/phpunit/x",
    "/actuator/health",
    "/boaform/admin",
  ])("flags %s as a probe", (route) => {
    expect(isProbePath(route)).toBe(true);
  });

  it.each(["/", "/chapter/2", "/about"])("leaves %s alone", (route) => {
    expect(isProbePath(route)).toBe(false);
  });
});

describe("botName", () => {
  it.each([
    ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "Googlebot"],
    ["Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)", "Bingbot"],
    [
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot",
      "GPTBot",
    ],
    [
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
      "ClaudeBot",
    ],
  ])("names %s", (ua, name) => {
    expect(botName(ua)).toEqual({ name, preview: false });
  });

  it("marks link previews, which are the trace a shared link leaves", () => {
    expect(botName("Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)")).toEqual({
      name: "Slack preview",
      preview: true,
    });
    expect(
      botName("LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)")?.preview,
    ).toBe(true);
    expect(botName("facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)")).toEqual({
      name: "Facebook preview",
      preview: true,
    });
  });

  it("names command-line tools", () => {
    expect(botName("curl/8.4.0")).toEqual({ name: "curl", preview: false });
  });

  it("files an unknown crawler under other bots", () => {
    expect(botName("SomethingBot/1.0")).toEqual({ name: "Other bots", preview: false });
  });

  it("treats a missing user agent as an automated client", () => {
    expect(botName("")).toEqual({ name: "Unknown client", preview: false });
    expect(botName("-")).toEqual({ name: "Unknown client", preview: false });
  });

  it("answers null for a browser", () => {
    expect(botName(CHROME_DESKTOP)).toBeNull();
    expect(botName(IPHONE_SAFARI)).toBeNull();
  });
});

describe("requestKind", () => {
  const kind = (method: string, route: string, query: string | null = null) => requestKind({ method, route, query });

  it("counts documents as pages", () => {
    expect(kind("GET", "/")).toBe(KIND.page);
    expect(kind("GET", "/about")).toBe(KIND.page);
    expect(kind("GET", "/x.html")).toBe(KIND.page);
  });

  it("counts files and build output as assets", () => {
    expect(kind("GET", "/_next/static/a.js")).toBe(KIND.asset);
    expect(kind("GET", "/logo.avif")).toBe(KIND.asset);
    expect(kind("GET", "/robots.txt")).toBe(KIND.asset);
  });

  it("keeps RSC fetches, API calls and writes out of both", () => {
    expect(kind("GET", "/chapter", "_rsc=abc")).toBe(KIND.other);
    expect(kind("POST", "/api/x")).toBe(KIND.other);
    expect(kind("GET", "/api/x")).toBe(KIND.other);
  });

  it("answers other for a row with no request line", () => {
    expect(requestKind({ method: null, route: null, query: null })).toBe(KIND.other);
  });
});
