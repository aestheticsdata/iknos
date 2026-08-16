import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RedisService } from "../redis/redis.service";
import { MAX_ATTEMPTS, RateLimitService, WINDOW_SECONDS } from "./ratelimit.service";

describe("RateLimitService", () => {
  let redis: RedisService;
  let limiter: RateLimitService;
  const keys: string[] = [];

  /** A fresh "IP" per test: a fixed one would carry its counter into the next run. */
  function ip(): string {
    const value = `test-${randomUUID()}`;
    keys.push(`iknos:rl:login:${value}`);
    return value;
  }

  beforeAll(async () => {
    redis = new RedisService();
    redis.onModuleInit();
    await redis.ready();
    limiter = new RateLimitService(redis);
  });

  afterAll(async () => {
    if (keys.length > 0) await redis.getClient().del(keys);
    await redis.onModuleDestroy();
  });

  it("allows exactly the budget, then stops", async () => {
    const client = ip();

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      expect(await limiter.allow(client)).toBe(true);
    }
    expect(await limiter.allow(client)).toBe(false);
  });

  it("counts each caller separately", async () => {
    const noisy = ip();
    for (let i = 0; i <= MAX_ATTEMPTS; i++) await limiter.allow(noisy);

    // Whoever else is behind the same nginx must not inherit someone's exhausted budget.
    expect(await limiter.allow(ip())).toBe(true);
  });

  it("sets the window once, so a burst cannot push it forward forever", async () => {
    const client = ip();
    const key = `iknos:rl:login:${client}`;

    await limiter.allow(client);
    await redis.getClient().expire(key, 5);
    await limiter.allow(client);

    // Still ~5s, not reset to 60: the expiry is set on the first attempt only. Otherwise a
    // caller hammering the endpoint would keep renewing their own lockout indefinitely.
    const ttl = await redis.getClient().ttl(key);
    expect(ttl).toBeLessThanOrEqual(5);
    expect(ttl).toBeGreaterThan(0);
  });

  it("gives the budget back on a successful login", async () => {
    const client = ip();
    for (let i = 0; i < MAX_ATTEMPTS; i++) await limiter.allow(client);

    await limiter.reset(client);

    // Someone who mistyped four times and then got it right should not be one attempt from a
    // lockout for the rest of the minute.
    expect(await limiter.allow(client)).toBe(true);
  });

  it("expires the counter on its own", async () => {
    const client = ip();
    await limiter.allow(client);

    const ttl = await redis.getClient().ttl(`iknos:rl:login:${client}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(WINDOW_SECONDS);
  });
});
