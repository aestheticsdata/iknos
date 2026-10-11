import { BlockList, isIP, isIPv4 } from "node:net";
import { WHOIS_REASON, WHOIS_STATUS } from "@contracts/whois";

import type { IpWhois, WhoisReason } from "@contracts/whois";

/**
 * ipwho.is — whois and geolocation in one keyless HTTPS call (IKN-73).
 *
 * Chosen over the ticket's other candidates for what it does not need: ip-api.com's free tier is
 * plain HTTP only, and GeoLite2 is a licence key, a 70 MB database to refresh on ks-b and a
 * `whois` binary for the registry half. ipwho.is answers both halves — country, city, ASN, org,
 * ISP — with no key at all, so there is nothing that could leak into a bundle in the first place.
 *
 * Pure: the address checks and the body parsing, nothing that opens a socket.
 */
export const IPWHO_BASE = "https://ipwho.is/";

/**
 * The address in the form it is cached and asked under, or `null` when it is not one.
 *
 * An IPv4-mapped IPv6 address (`::ffff:203.0.113.9`, what Node reports for a v4 caller on a
 * dual-stack socket) is unwrapped: it is the same caller as the bare v4, and two cache entries for
 * one address would make the second click on it an external call.
 */
export function normalizeIp(raw: string): string | null {
  const ip = raw.trim().toLowerCase();
  const mapped = ip.startsWith("::ffff:") ? ip.slice("::ffff:".length) : null;
  if (mapped !== null && isIPv4(mapped)) return mapped;
  return isIP(ip) === 0 ? null : ip;
}

/** Ranges no registry places: asking a provider about them is a wasted call that says "reserved". */
const PRIVATE = new BlockList();
PRIVATE.addSubnet("0.0.0.0", 8, "ipv4");
PRIVATE.addSubnet("10.0.0.0", 8, "ipv4");
PRIVATE.addSubnet("100.64.0.0", 10, "ipv4");
PRIVATE.addSubnet("127.0.0.0", 8, "ipv4");
PRIVATE.addSubnet("169.254.0.0", 16, "ipv4");
PRIVATE.addSubnet("172.16.0.0", 12, "ipv4");
PRIVATE.addSubnet("192.168.0.0", 16, "ipv4");
PRIVATE.addSubnet("224.0.0.0", 3, "ipv4");
PRIVATE.addAddress("::", "ipv6");
PRIVATE.addAddress("::1", "ipv6");
PRIVATE.addSubnet("fc00::", 7, "ipv6");
PRIVATE.addSubnet("fe80::", 10, "ipv6");
PRIVATE.addSubnet("ff00::", 8, "ipv6");

/** Takes a `normalizeIp` result — a mapped v4 has already been unwrapped by then. */
export function isPrivateIp(ip: string): boolean {
  return PRIVATE.check(ip, isIPv4(ip) ? "ipv4" : "ipv6");
}

export function ipwhoUrl(ip: string): string {
  return `${IPWHO_BASE}${encodeURIComponent(ip)}`;
}

/** An answer with nothing in it but why — the shape of every `unknown`. */
export function unknownWhois(ip: string, reason: WhoisReason): IpWhois {
  return {
    ip,
    status: WHOIS_STATUS.unknown,
    reason,
    country: null,
    countryCode: null,
    region: null,
    city: null,
    asn: null,
    org: null,
    isp: null,
    domain: null,
    fetchedAt: null,
    cached: false,
  };
}

/** Provider strings are untrusted input rendered in the view: bounded, and empty means absent. */
const MAX_FIELD_LENGTH = 120;

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed.slice(0, MAX_FIELD_LENGTH);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * ipwho.is's body as an answer, or `null` when it is not one of the two shapes it documents.
 *
 * `success: false` is the provider saying it has nothing for this address — `refused`, which is a
 * fact worth caching. A body that is neither shape (an HTML error page from the CDN, a schema
 * change) is `null`, which the service turns into `unavailable` and does not cache.
 */
export function fromIpwho(ip: string, body: unknown, fetchedAt: Date): IpWhois | null {
  if (!isRecord(body) || typeof body.success !== "boolean") return null;
  if (!body.success) return { ...unknownWhois(ip, WHOIS_REASON.refused), fetchedAt: fetchedAt.toISOString() };

  const connection = isRecord(body.connection) ? body.connection : {};
  const asn = typeof connection.asn === "number" && Number.isInteger(connection.asn) ? connection.asn : null;

  return {
    ip,
    status: WHOIS_STATUS.found,
    reason: null,
    country: text(body.country),
    countryCode: text(body.country_code),
    region: text(body.region),
    city: text(body.city),
    asn,
    org: text(connection.org),
    isp: text(connection.isp),
    domain: text(connection.domain),
    fetchedAt: fetchedAt.toISOString(),
    cached: false,
  };
}
