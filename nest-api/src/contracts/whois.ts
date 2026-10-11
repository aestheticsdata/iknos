/**
 * Who an address belongs to and where it is — `GET /api/whois/:ip` (IKN-73).
 *
 * Asked of one address because somebody clicked it, never of a row at ingestion: the logs carry
 * thousands of addresses a day and the provider is free only under a rate limit. The answer is
 * cached per address on the API, so the second click on the same caller costs nothing outside the
 * box, and `cached` says which kind of click this was.
 */

/** `found` — the provider placed it. `unknown` — it did not, and `reason` says why. */
export const WHOIS_STATUS = {
  found: "found",
  unknown: "unknown",
} as const;

export type WhoisStatus = (typeof WHOIS_STATUS)[keyof typeof WHOIS_STATUS];

/**
 * Why an address is `unknown`.
 *
 * `private` — loopback, RFC 1918, link-local, CGNAT, ULA: an address no registry can place, so
 * it is answered on the box without asking anyone. 127.0.0.1 is the commonest of them — every app
 * behind nginx that does not trust its proxy logs that.
 * `refused` — the provider answered and said it has nothing (a reserved range it knows of, a
 * bogon). A fact about the address, cached like a found one.
 * `unavailable` — the provider was down, slow, rate-limiting or answered nonsense. A fact about
 * the provider at that moment, so it is never cached: the next click asks again.
 */
export const WHOIS_REASON = {
  private: "private",
  refused: "refused",
  unavailable: "unavailable",
} as const;

export type WhoisReason = (typeof WHOIS_REASON)[keyof typeof WHOIS_REASON];

/** Every field past `reason` is `null` when the provider did not say — never an empty string. */
export type IpWhois = {
  ip: string;
  status: WhoisStatus;
  /** `null` exactly when `status` is `found`. */
  reason: WhoisReason | null;
  country: string | null;
  /** ISO 3166-1 alpha-2. */
  countryCode: string | null;
  region: string | null;
  city: string | null;
  /** The autonomous system number — what says "hosting range" before the org name does. */
  asn: number | null;
  /** The registrant of the range. */
  org: string | null;
  isp: string | null;
  domain: string | null;
  /** ISO-8601, UTC — when the provider was asked. `null` for an answer that never left the box. */
  fetchedAt: string | null;
  /** Served from the API's cache: no external call was made for this request. */
  cached: boolean;
};
