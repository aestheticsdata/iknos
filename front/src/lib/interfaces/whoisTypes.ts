/**
 * What `GET /api/whois/:ip` returns, restated — the authoritative copy is
 * `nest-api/src/contracts/whois.ts`, like every other contract in this front end (IKN-73).
 *
 * Every field past `reason` is `null` when the provider did not say — never an empty string.
 */

/** Mirrors `contracts/whois.ts`. */
export const WHOIS_STATUS = {
  found: "found",
  unknown: "unknown",
} as const;

export type WhoisStatus = (typeof WHOIS_STATUS)[keyof typeof WHOIS_STATUS];

/**
 * Mirrors `contracts/whois.ts`. `private` never left the box, `refused` is the provider saying it
 * has nothing, `unavailable` is the provider down, slow or rate-limited — and asked again next time.
 */
export const WHOIS_REASON = {
  private: "private",
  refused: "refused",
  unavailable: "unavailable",
} as const;

export type WhoisReason = (typeof WHOIS_REASON)[keyof typeof WHOIS_REASON];

/** Mirrors `contracts/whois.ts`. */
export type IpWhois = {
  ip: string;
  status: WhoisStatus;
  reason: WhoisReason | null;
  country: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  asn: number | null;
  org: string | null;
  isp: string | null;
  domain: string | null;
  /** ISO-8601, UTC. `null` for an answer that never left the box. */
  fetchedAt: string | null;
  /** Served from the API's cache — no external call was made for this click. */
  cached: boolean;
};

/**
 * One address's lookup as the view holds it — `useWhois`'s answer.
 *
 * `requested` is the whole of the click-only rule on this side: nothing is fetched, and nothing is
 * drawn, until the reader has asked about this address.
 */
export type WhoisLookup = {
  requested: boolean;
  loading: boolean;
  answer: IpWhois | null;
  /** The request itself failed — the API was unreachable, not the provider. */
  error: string | null;
  lookup: () => void;
};
