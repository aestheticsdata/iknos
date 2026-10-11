import { WHOIS_REASON, WHOIS_STATUS } from "@contracts/whois";
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { fromIpwho, ipwhoUrl, isPrivateIp, normalizeIp, unknownWhois } from "./ipwho";

import type { IpWhois } from "@contracts/whois";
import type { WhoisCache, WhoisFetch } from "./interfaces/whois-types";

/** Shared Redis: namespaced like every other key Iknos writes. */
export const WHOIS_PREFIX = "iknos:whois:";

/** Country and ASN of an address change on the scale of years; a month is the ticket's "long". */
export const WHOIS_TTL_SECONDS = 30 * 24 * 60 * 60;

/** A provider slower than this is answered as `unavailable` — the view must never sit on it. */
export const WHOIS_TIMEOUT_MS = 4000;

/** A whois body is under a kilobyte; anything past this is not one. */
const MAX_BODY_CHARS = 16 * 1024;

/**
 * One address, looked up on demand and cached server-side (IKN-73).
 *
 * The external call happens in exactly one place — `ask` — and only on a cache miss for a public
 * address, which only a click on an address reaches. Nothing here runs on a timer or at
 * ingestion.
 *
 * **Concurrent clicks on one address share one call.** The row's button and the grouped panel's
 * can both be pressed before the first answer lands, and two misses would be two external calls
 * for one question. `inFlight` holds the pending lookup until it settles.
 *
 * Never throws for a provider failure: down, slow, rate-limited or nonsense all become an
 * `unknown` with `reason: unavailable`, answered within `WHOIS_TIMEOUT_MS`.
 */
@Injectable()
export class WhoisService {
  private readonly logger = new Logger(WhoisService.name);
  private readonly inFlight = new Map<string, Promise<IpWhois>>();

  constructor(
    private readonly cache: WhoisCache,
    private readonly fetchImpl: WhoisFetch,
    private readonly timeoutMs: number = WHOIS_TIMEOUT_MS,
  ) {}

  async lookup(raw: string): Promise<IpWhois> {
    const ip = normalizeIp(raw);
    if (ip === null) throw new BadRequestException("'ip' must be an IPv4 or IPv6 address");
    if (isPrivateIp(ip)) return unknownWhois(ip, WHOIS_REASON.private);

    const hit = await this.cached(ip);
    if (hit !== null) return { ...hit, cached: true };

    const pending = this.inFlight.get(ip);
    if (pending !== undefined) return pending;

    const lookup = this.ask(ip).finally(() => this.inFlight.delete(ip));
    this.inFlight.set(ip, lookup);
    return lookup;
  }

  private async ask(ip: string): Promise<IpWhois> {
    const answer = await this.fetchAnswer(ip);
    // `unavailable` is the provider's state at this moment, not the address's — caching it would
    // turn one rate-limited minute into a month of "unknown".
    if (answer.reason !== WHOIS_REASON.unavailable) await this.store(answer);
    return answer;
  }

  private async fetchAnswer(ip: string): Promise<IpWhois> {
    try {
      const response = await this.fetchImpl(ipwhoUrl(ip), { signal: AbortSignal.timeout(this.timeoutMs) });
      if (response.status !== 200) {
        this.logger.warn(`whois provider answered ${response.status} for ${ip}`);
        return unknownWhois(ip, WHOIS_REASON.unavailable);
      }
      const body = (await response.text()).slice(0, MAX_BODY_CHARS);
      const answer = fromIpwho(ip, JSON.parse(body), new Date());
      if (answer === null) this.logger.warn(`whois provider answered an unrecognised body for ${ip}`);
      return answer ?? unknownWhois(ip, WHOIS_REASON.unavailable);
    } catch (error) {
      this.logger.warn(`whois lookup failed for ${ip}: ${error instanceof Error ? error.message : String(error)}`);
      return unknownWhois(ip, WHOIS_REASON.unavailable);
    }
  }

  /** A Redis that is down is a miss, not a failed lookup — the provider can still answer. */
  private async cached(ip: string): Promise<IpWhois | null> {
    try {
      const value = await this.cache.get(`${WHOIS_PREFIX}${ip}`);
      if (value === null) return null;
      const parsed = JSON.parse(value) as IpWhois;
      return parsed.status === WHOIS_STATUS.found || parsed.status === WHOIS_STATUS.unknown ? parsed : null;
    } catch {
      return null;
    }
  }

  private async store(answer: IpWhois): Promise<void> {
    try {
      await this.cache.set({
        key: `${WHOIS_PREFIX}${answer.ip}`,
        value: JSON.stringify(answer),
        ttlSeconds: WHOIS_TTL_SECONDS,
      });
    } catch (error) {
      this.logger.warn(`whois cache write failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
