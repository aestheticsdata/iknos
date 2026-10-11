import { WHOIS_REASON, WHOIS_STATUS } from "@lib/interfaces/whoisTypes";
import { LOGS_TEXT } from "@text/logs";
import { describe, expect, it } from "vitest";
import { whoisNetwork, whoisPlace, whoisUnknown } from "./whoisFormat";

import type { IpWhois } from "@lib/interfaces/whoisTypes";

const base: IpWhois = {
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
};

describe("whoisPlace", () => {
  it("reads city, region, country code", () => {
    expect(whoisPlace(base)).toBe("San Jose, California, US");
  });

  it("drops what the provider did not give, and says a repeated name once", () => {
    expect(whoisPlace({ ...base, city: null, region: null })).toBe("US");
    expect(whoisPlace({ ...base, city: "Singapore", region: "Singapore", countryCode: "SG" })).toBe("Singapore, SG");
    expect(whoisPlace({ ...base, countryCode: null })).toBe("San Jose, California, United States");
  });

  it("is null with nothing to say", () => {
    expect(whoisPlace({ ...base, city: null, region: null, country: null, countryCode: null })).toBeNull();
  });
});

describe("whoisNetwork", () => {
  it("leads with the ASN and skips an ISP that is the org again", () => {
    expect(whoisNetwork(base)).toBe("AS15169 · Google LLC · google.com");
  });

  it("keeps an ISP that differs from the org", () => {
    expect(whoisNetwork({ ...base, isp: "Level 3", domain: null })).toBe("AS15169 · Google LLC · Level 3");
  });

  it("is null with nothing to say", () => {
    expect(whoisNetwork({ ...base, asn: null, org: null, isp: null, domain: null })).toBeNull();
  });
});

describe("whoisUnknown", () => {
  it("states every reason, and a missing one as unavailable", () => {
    expect(whoisUnknown(WHOIS_REASON.private)).toBe(LOGS_TEXT.whoisUnknown.private);
    expect(whoisUnknown(WHOIS_REASON.refused)).toBe(LOGS_TEXT.whoisUnknown.refused);
    expect(whoisUnknown(null)).toBe(LOGS_TEXT.whoisUnknown.unavailable);
  });
});
