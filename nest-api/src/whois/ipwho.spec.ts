import { WHOIS_REASON, WHOIS_STATUS } from "@contracts/whois";
import { describe, expect, it } from "vitest";
import { fromIpwho, ipwhoUrl, isPrivateIp, normalizeIp } from "./ipwho";

const AT = new Date("2026-10-11T12:00:00Z");

describe("normalizeIp", () => {
  it("accepts v4 and v6, trimmed and lower-cased", () => {
    expect(normalizeIp(" 203.0.113.9 ")).toBe("203.0.113.9");
    expect(normalizeIp("2001:DB8::1")).toBe("2001:db8::1");
  });

  it("unwraps an IPv4-mapped address, so one caller is one cache entry", () => {
    expect(normalizeIp("::ffff:203.0.113.9")).toBe("203.0.113.9");
  });

  it("refuses anything that is not an address", () => {
    expect(normalizeIp("999.1.1.1")).toBeNull();
    expect(normalizeIp("example.com")).toBeNull();
    expect(normalizeIp("1.2.3.4/../admin")).toBeNull();
    expect(normalizeIp("")).toBeNull();
  });
});

describe("isPrivateIp", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.20.0.1",
    "192.168.1.1",
    "100.64.0.1",
    "169.254.1.1",
    "::1",
    "fd00::1",
    "fe80::1",
  ])("keeps %s on the box", (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "203.0.113.9", "172.32.0.1", "2001:4860:4860::8888"])("asks the provider about %s", (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });
});

describe("ipwhoUrl", () => {
  it("puts the address in the path", () => {
    expect(ipwhoUrl("2001:db8::1")).toBe("https://ipwho.is/2001%3Adb8%3A%3A1");
  });
});

describe("fromIpwho", () => {
  it("reads the place and the registry half", () => {
    const body = {
      ip: "8.8.8.8",
      success: true,
      country: "United States",
      country_code: "US",
      region: "California",
      city: "San Jose",
      connection: { asn: 15169, org: "Google LLC", isp: "Google LLC", domain: "google.com" },
    };

    expect(fromIpwho("8.8.8.8", body, AT)).toEqual({
      ip: "8.8.8.8",
      status: WHOIS_STATUS.found,
      reason: null,
      country: "United States",
      countryCode: "US",
      region: "California",
      city: "San Jose",
      asn: 15169,
      org: "Google LLC",
      isp: "Google LLC",
      domain: "google.com",
      fetchedAt: "2026-10-11T12:00:00.000Z",
      cached: false,
    });
  });

  it("turns empty and missing fields into null, never an empty string", () => {
    const answer = fromIpwho("8.8.8.8", { success: true, country: "  ", connection: { asn: "15169" } }, AT);
    expect(answer).toMatchObject({ country: null, city: null, asn: null, org: null });
  });

  it("is refused when the provider says it has nothing", () => {
    const answer = fromIpwho("192.0.2.1", { success: false, message: "Reserved range" }, AT);
    expect(answer).toMatchObject({ status: WHOIS_STATUS.unknown, reason: WHOIS_REASON.refused });
  });

  it("is no answer at all for a body of another shape", () => {
    expect(fromIpwho("8.8.8.8", "<html>", AT)).toBeNull();
    expect(fromIpwho("8.8.8.8", { error: "quota" }, AT)).toBeNull();
    expect(fromIpwho("8.8.8.8", null, AT)).toBeNull();
  });

  it("bounds a provider string before it reaches the view", () => {
    const answer = fromIpwho("8.8.8.8", { success: true, connection: { org: "x".repeat(500) } }, AT);
    expect(answer?.org).toHaveLength(120);
  });
});
