import { Injectable } from "@nestjs/common";
import { RedisService } from "../redis/redis.service";

export const MAX_ATTEMPTS = 5;
export const WINDOW_SECONDS = 60;

const KEY_PREFIX = "iknos:rl:login:";

/**
 * Fixed-window counter for login attempts, keyed by client IP.
 *
 * Iknos has exactly one account, and its address is the owner's — so the only thing standing
 * between a guessed password and a log console on the public internet is how many guesses fit
 * in a minute.
 */
@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  /** False once the budget is spent. */
  async allow(ip: string): Promise<boolean> {
    const key = `${KEY_PREFIX}${ip}`;
    const client = this.redis.getClient();

    const count = await client.incr(key);
    if (count === 1) {
      // Only the first attempt in a window sets the expiry. Refreshing it on every call would
      // let a caller hammering the endpoint keep pushing their own window forward, turning a
      // one-minute lockout into a permanent one.
      await client.expire(key, WINDOW_SECONDS);
    }

    return count <= MAX_ATTEMPTS;
  }

  /**
   * Called after a successful login.
   *
   * Without it, someone who mistypes four times before getting it right spends the rest of the
   * minute one attempt from a lockout — punishing the legitimate owner for the failure mode the
   * limit exists to tolerate.
   */
  async reset(ip: string): Promise<void> {
    await this.redis.getClient().del(`${KEY_PREFIX}${ip}`);
  }
}
