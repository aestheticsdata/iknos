import { BUCKET, STATUS_CLASS } from "@contracts/traffic";
import { describe, expect, it } from "vitest";
import { aggregate, summarize } from "./aggregate";
import { DIRECT_SOURCE } from "./referrer";

import type { AccessRow, TrafficWindow } from "./interfaces/traffic-types";

const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const SLACK = "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)";

const HUMAN_IP = "203.0.113.5";
const OTHER_HUMAN_IP = "198.51.100.7";
const SCANNER_IP = "9.9.9.9";
const OWN = "https://fiducia.example/";

const to = new Date("2026-10-31T09:00:00Z");
const WINDOW: TrafficWindow = {
  from: new Date(+to - 7 * 86_400_000),
  to,
  tz: "Europe/Paris",
  retentionDays: 14,
  now: to,
};

let clock = +new Date("2026-10-30T10:00:00Z");

/** One access row, a second after the previous one, so the fixture is in `ts` order like the query. */
const row = (overrides: Partial<AccessRow>): AccessRow => {
  clock += 1000;
  return {
    ts: new Date(clock),
    clientIp: HUMAN_IP,
    httpMethod: "GET",
    route: "/",
    statusCode: 200,
    referrer: null,
    userAgent: CHROME,
    bytes: 1000,
    query: null,
    ...overrides,
  };
};

const FIXTURE: AccessRow[] = [
  row({ route: "/", referrer: "https://news.ycombinator.com/item?id=1" }),
  row({ route: "/_next/static/app.js", referrer: OWN }),
  row({ route: "/hero.avif", referrer: OWN, bytes: 50_000 }),
  row({ route: "/about", referrer: `${OWN}` }),
  row({ route: "/about", query: "_rsc=1", referrer: OWN }),
  row({ clientIp: "66.249.66.1", userAgent: GOOGLEBOT }),
  row({ clientIp: "3.3.3.3", userAgent: SLACK }),
  row({ clientIp: SCANNER_IP, route: "/wp-login.php", statusCode: 404, userAgent: CHROME }),
  row({ clientIp: SCANNER_IP, route: "/", userAgent: CHROME }),
  row({ clientIp: OTHER_HUMAN_IP, route: "/missing", statusCode: 404, referrer: "https://t.co/x", userAgent: IPHONE }),
  // An unparsed line: stored with every promoted column null.
  row({ clientIp: null, httpMethod: null, route: null, statusCode: null, userAgent: null, bytes: null }),
];

describe("aggregate", () => {
  const result = aggregate(FIXTURE, WINDOW);

  it("counts the human's page views and one visitor-day", () => {
    // The second human only collected a 404, which is not a page view.
    expect(result.totals.visitorDays).toBe(1);
    expect(result.totals.pageViews).toBe(2);
  });

  it("sorts every request into human, bot or scanner, skipping the unparsed line", () => {
    expect(result.totals.requests).toBe(10);
    expect(result.totals.humanRequests).toBe(6);
    expect(result.totals.botRequests).toBe(2);
    expect(result.totals.scannerRequests).toBe(2);
  });

  it("infers the site's own host from its assets' referrers", () => {
    expect(result.ownHost).toBe("fiducia.example");
  });

  it("credits the visit to the outside source of its first page, not to the site itself", () => {
    expect(result.sources).toEqual([
      { name: "Hacker News", host: "news.ycombinator.com", visitorDays: 1, pageViews: 2, landings: ["/"] },
    ]);
  });

  it("lists entry and top pages", () => {
    expect(result.entryPages).toEqual([{ route: "/", visitorDays: 1 }]);
    expect(result.topPages).toEqual([
      { route: "/", pageViews: 1, visitorDays: 1 },
      { route: "/about", pageViews: 1, visitorDays: 1 },
    ]);
    expect(result.morePages).toBe(0);
  });

  it("names the bots and counts the scanner without listing it", () => {
    expect(result.bots.map((bot) => [bot.name, bot.preview, bot.requests])).toEqual([
      ["Slack preview", true, 1],
      ["Googlebot", false, 1],
    ]);
    expect(result.totals.previews).toBe(1);
    expect(result.scanners).toEqual({ requests: 2, addresses: 1 });
  });

  it("lists the 404s people hit, with who sent them", () => {
    expect(result.brokenLinks).toEqual([{ route: "/missing", source: "X", hits: 1 }]);
  });

  it("splits status classes between humans and automated clients", () => {
    const s4xx = result.status.find((row) => row.class === STATUS_CLASS.s4xx);
    expect(s4xx).toEqual({ class: STATUS_CLASS.s4xx, human: 1, automated: 1 });
    expect(result.topCodes[0]).toEqual({ code: 200, requests: 8 });
  });

  it("reads browsers, systems and devices per visitor-day", () => {
    expect(result.browsers).toEqual([{ name: "Chrome", visitorDays: 1 }]);
    expect(result.systems).toEqual([{ name: "Windows", visitorDays: 1 }]);
    expect(result.devices).toEqual([{ name: "desktop", visitorDays: 1 }]);
  });

  it("places page views on the reader's clock and visitors in the bucket of their first view", () => {
    expect(result.bucket).toBe(BUCKET.day);
    expect(result.hourOfDay[11]).toBe(2); // 10:00 UTC is 11:00 in Paris
    const day = result.series.find((point) => point.t === "2026-10-29T23:00:00.000Z");
    expect(day).toMatchObject({ visitorDays: 1, pageViews: 2, botRequests: 2, scannerRequests: 2 });
  });

  it("sums bandwidth across everyone", () => {
    expect(result.totals.bytes).toBe(59_000);
  });

  it("leaks no client address", () => {
    const body = JSON.stringify(result);
    for (const ip of [HUMAN_IP, OTHER_HUMAN_IP, SCANNER_IP, "66.249.66.1", "3.3.3.3"]) {
      expect(body).not.toContain(ip);
    }
  });

  it("reads campaigns from the landing page's query", () => {
    const tagged = aggregate(
      [row({ clientIp: "192.0.2.1", query: "utm_source=newsletter&utm_medium=email&utm_campaign=oct" })],
      WINDOW,
    );
    expect(tagged.campaigns).toEqual([
      { source: "newsletter", medium: "email", campaign: "oct", visitorDays: 1, pageViews: 1 },
    ]);
  });

  it("answers an empty range with zeros and a gap-filled series", () => {
    const empty = aggregate([], WINDOW);
    expect(empty.totals.visitorDays).toBe(0);
    expect(empty.ownHost).toBeNull();
    expect(empty.series).toHaveLength(8);
    expect(empty.series.every((point) => point.visitorDays === 0)).toBe(true);
    expect(empty.hourOfDay).toHaveLength(24);
  });

  it("ignores rows older than the retention cut, so the totals match the series", () => {
    const old = row({ clientIp: "192.0.2.50", ts: new Date(+to - 10 * 86_400_000) });
    const counted = aggregate([old], { ...WINDOW, from: new Date(+to - 14 * 86_400_000), retentionDays: 7 });
    expect(counted.totals.requests).toBe(0);
    expect(counted.totals.visitorDays).toBe(0);
  });

  it("counts a scanner that returns on another day as one address", () => {
    const probe = (day: string) => row({ clientIp: "45.0.0.9", route: "/.env", statusCode: 404, ts: new Date(day) });
    const twice = aggregate([probe("2026-10-28T10:00:00Z"), probe("2026-10-29T10:00:00Z")], WINDOW);
    expect(twice.scanners).toEqual({ requests: 2, addresses: 1 });
  });

  it("survives attrs that are not strings", () => {
    const odd = aggregate([row({ userAgent: 42, referrer: { a: 1 }, query: 7, bytes: "big" })], WINDOW);
    expect(odd.totals.requests).toBe(1);
    expect(odd.totals.botRequests).toBe(1); // no usable user agent: an unknown client
    expect(odd.totals.bytes).toBe(0);
  });
});

describe("summarize", () => {
  it("names the top outside source and the human share", () => {
    const summary = summarize(aggregate(FIXTURE, WINDOW));
    expect(summary).toMatchObject({ visitorDays: 1, pageViews: 2, requests: 10, topSource: "Hacker News" });
    expect(summary.humanShare).toBeCloseTo(0.6);
    expect(summary.series).toHaveLength(8);
  });

  it("falls back to direct when it is the only source, and to null with none", () => {
    expect(summarize(aggregate([row({ clientIp: "192.0.2.9" })], WINDOW)).topSource).toBe(DIRECT_SOURCE);
    const empty = summarize(aggregate([], WINDOW));
    expect(empty.topSource).toBeNull();
    expect(empty.humanShare).toBeNull();
  });
});
