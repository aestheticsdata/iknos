import { WHOIS_REASON } from "@lib/interfaces/whoisTypes";
import { LOGS_TEXT } from "@text/logs";

import type { IpWhois, WhoisReason } from "@lib/interfaces/whoisTypes";

/**
 * A whois answer as the two lines the view prints (IKN-73) — where, then whose.
 *
 * Each line drops the parts the provider did not give rather than printing a dash for them, and is
 * `null` when it has none at all: a line reading only `·` describes nothing.
 */

/** `San Jose, California, US` — city first, because the country alone rarely decides anything. */
export const whoisPlace = (w: IpWhois): string | null => {
  const parts = [w.city, w.region, w.countryCode ?? w.country].filter((p): p is string => p !== null);
  // A region named like its city (`Singapore, Singapore`) says the same word twice.
  const distinct = parts.filter((p, i) => i === 0 || p !== parts[i - 1]);
  return distinct.length === 0 ? null : distinct.join(", ");
};

/**
 * `AS15169 · Google LLC · google.com` — the ASN leads: it is what tells a hosting range from a
 * residential line, which is the question the lookup exists to answer. The ISP is printed only when
 * it is not the org again, which for a datacentre range it nearly always is.
 */
export const whoisNetwork = (w: IpWhois): string | null => {
  const isp = w.isp !== null && w.isp !== w.org ? w.isp : null;
  const parts = [w.asn === null ? null : `AS${w.asn}`, w.org, isp, w.domain].filter((p): p is string => p !== null);
  return parts.length === 0 ? null : parts.join(" · ");
};

/** The one sentence an `unknown` answer gets — always a stated reason, never a blank. */
export const whoisUnknown = (reason: WhoisReason | null): string =>
  LOGS_TEXT.whoisUnknown[reason ?? WHOIS_REASON.unavailable];
