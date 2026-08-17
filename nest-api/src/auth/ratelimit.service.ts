import { Injectable } from "@nestjs/common";
import { RedisService } from "../redis/redis.service";

export type Limit = { max: number; windowSeconds: number };

/** Per client IP. Guessing a password is cheap; this is what makes it slow. */
export const LOGIN_LIMIT: Limit = { max: 5, windowSeconds: 60 };

/**
 * Per **e-mail address**, not per IP, and the trade-off is deliberate.
 *
 * Keyed by IP, anyone rotating addresses gets unlimited attempts at the passphrase — and against
 * a single, known account that is the attack that matters. Keyed by e-mail, someone can burn the
 * owner's budget and lock them out for a quarter of an hour. Zeus made the same call.
 */
export const RECOVERY_LIMIT: Limit = { max: 5, windowSeconds: 15 * 60 };

/**
 * Per client IP, and generous compared to the two above — because this one is not guarding a
 * secret, it is stopping a runaway page.
 *
 * A browser batches its errors, so one request a second is already an app in trouble. The number
 * that matters is what a render loop throwing on every frame would cost: capped here, it costs
 * sixty rows a minute instead of filling the table.
 */
export const INGEST_LIMIT: Limit = { max: 60, windowSeconds: 60 };

/** Kept for the login spec, which predates the second scope. */
export const MAX_ATTEMPTS = LOGIN_LIMIT.max;
export const WINDOW_SECONDS = LOGIN_LIMIT.windowSeconds;

@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  private key(scope: string, id: string): string {
    return `iknos:rl:${scope}:${id}`;
  }

  /** False once the budget is spent. */
  private async hit(scope: string, id: string, limit: Limit): Promise<boolean> {
    const key = this.key(scope, id);
    const client = this.redis.getClient();

    const count = await client.incr(key);
    if (count === 1) {
      // Only the first attempt in a window sets the expiry. Refreshing it on every call would
      // let a caller hammering the endpoint keep pushing their own window forward, turning a
      // bounded lockout into a permanent one.
      await client.expire(key, limit.windowSeconds);
    }

    return count <= limit.max;
  }

  private async clear(scope: string, id: string): Promise<void> {
    await this.redis.getClient().del(this.key(scope, id));
  }

  allow(ip: string): Promise<boolean> {
    return this.hit("login", ip, LOGIN_LIMIT);
  }

  /**
   * Called after a successful login.
   *
   * Without it, someone who mistypes four times before getting it right spends the rest of the
   * minute one attempt from a lockout — punishing the legitimate owner for the failure mode the
   * limit exists to tolerate. It costs the limit nothing: clearing it requires the password.
   */
  reset(ip: string): Promise<void> {
    return this.clear("login", ip);
  }

  allowRecovery(email: string): Promise<boolean> {
    return this.hit("recover", email, RECOVERY_LIMIT);
  }

  /** No `reset` counterpart: nothing a caller can do proves it deserves a fresh budget. */
  allowIngest(ip: string): Promise<boolean> {
    return this.hit("ingest", ip, INGEST_LIMIT);
  }

  resetRecovery(email: string): Promise<void> {
    return this.clear("recover", email);
  }
}
