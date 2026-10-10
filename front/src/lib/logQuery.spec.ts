import { describe, expect, it } from "vitest";
import { LOG_FILTER, logDetailUrl, logHistogramUrl, logIpGroupsUrl, logSearchUrl, logStreamUrl } from "./logQuery";

import type { LogQueryState } from "./logQuery";

const stateAt = (anchor: string | null): LogQueryState => ({
  values: { service: null, level: null, route: null, status: null, q: null, ip: null },
  off: [],
  bounds: { from: "2026-08-09T00:00:00.000Z", to: "2026-08-10T00:00:00.000Z" },
  pinned: anchor !== null,
  anchor,
});

describe("logSearchUrl", () => {
  const params = (state: LogQueryState, opts?: Parameters<typeof logSearchUrl>[1]) =>
    new URL(logSearchUrl(state, opts), "http://x").searchParams;

  it("omits dir for the default before direction — every call before IKN-59 already did", () => {
    expect(params(stateAt(null)).has("dir")).toBe(false);
    expect(params(stateAt(null), { dir: "before" }).has("dir")).toBe(false);
  });

  it("marks the after direction explicitly", () => {
    expect(params(stateAt(null), { dir: "after" }).get("dir")).toBe("after");
  });

  it("seeds the first page at the anchor when there is one and no cursor yet", () => {
    expect(params(stateAt("2026-08-09T10:00:00.000Z")).get("at")).toBe("2026-08-09T10:00:00.000Z");
  });

  it("sends no at at all once there is no anchor to seed from", () => {
    expect(params(stateAt(null)).has("at")).toBe(false);
  });

  it("prefers a real cursor over the anchor — a page already in hand beats the seed that started it", () => {
    const found = params(stateAt("2026-08-09T10:00:00.000Z"), { cursor: "abc123" });

    expect(found.get("cursor")).toBe("abc123");
    expect(found.has("at")).toBe(false);
  });
});

describe("the ip token (IKN-72)", () => {
  const withIp = (off: LogQueryState["off"] = []): LogQueryState => ({
    ...stateAt(null),
    values: { ...stateAt(null).values, status: "404", ip: "198.51.100.23" },
    off,
  });
  const params = (url: string) => new URL(url, "http://x").searchParams;

  it("travels to the list, the histogram, the tail and the grouping alike, beside the other filters", () => {
    for (const url of [
      logSearchUrl(withIp()),
      logHistogramUrl(withIp()),
      logStreamUrl(withIp()),
      logIpGroupsUrl(withIp()),
    ]) {
      expect(params(url).get("ip")).toBe("198.51.100.23");
      expect(params(url).get("status")).toBe("404");
    }
  });

  it("contributes nothing while switched off, and keeps the others", () => {
    const found = params(logSearchUrl(withIp([LOG_FILTER.ip])));

    expect(found.has("ip")).toBe(false);
    expect(found.get("status")).toBe("404");
  });

  it("points the grouping at its own route, bounded like every other", () => {
    const url = logIpGroupsUrl(withIp());

    expect(url.startsWith("/logs/ips?")).toBe(true);
    expect(params(url).get("from")).toBe("2026-08-09T00:00:00.000Z");
    expect(params(url).get("to")).toBe("2026-08-10T00:00:00.000Z");
  });
});

describe("logDetailUrl", () => {
  const at = (ts: string) => new URL(logDetailUrl({ id: "42", ts }), "http://x").searchParams;

  it("bounds the lookup to the row's own millisecond", () => {
    // The endpoint compares `ts >= from AND ts < to`, so this is the smallest window that contains
    // the row at all — and the tightest partition prune there is on a table partitioned by day.
    const params = at("2026-08-09T10:11:12.345Z");

    expect(params.get("from")).toBe("2026-08-09T10:11:12.345Z");
    expect(params.get("to")).toBe("2026-08-09T10:11:12.346Z");
  });

  it("carries no bound that could move under the open row", () => {
    // Not the panel's range, deliberately: `refresh` re-takes `now`, every relative range slides
    // with it, and a line expanded near the edge of a 15-minute window would start answering 404
    // while still visibly sitting in the list.
    expect(logDetailUrl({ id: "42", ts: "2026-08-09T10:11:12.345Z" })).toBe(
      logDetailUrl({ id: "42", ts: "2026-08-09T10:11:12.345Z" }),
    );
  });

  it("rolls the upper bound over a second, a day and a year", () => {
    expect(at("2026-08-09T10:11:12.999Z").get("to")).toBe("2026-08-09T10:11:13.000Z");
    expect(at("2026-08-09T23:59:59.999Z").get("to")).toBe("2026-08-10T00:00:00.000Z");
    expect(at("2026-12-31T23:59:59.999Z").get("to")).toBe("2027-01-01T00:00:00.000Z");
  });

  it("addresses the row by its id, escaped", () => {
    expect(logDetailUrl({ id: "9007199254740993", ts: "2026-08-09T10:11:12.345Z" })).toContain(
      "/logs/entry/9007199254740993?",
    );
  });
});
