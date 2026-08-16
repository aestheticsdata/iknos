import { Injectable, Logger } from "@nestjs/common";
import { createClient } from "redis";

import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { RedisClientType } from "redis";

/**
 * Key prefix for everything express-session writes, `iknos.sid` values included.
 *
 * It lives here rather than beside the cookie name because it is Redis' concern: this file is
 * the only one that sweeps the keyspace, and `clearSessionsForUser` has to match exactly what
 * `RedisStore` wrote.
 */
export const SESSION_PREFIX = "iknos:sess:";

/**
 * The fleet's Redis service, ported from trekker.
 *
 * One client for the whole process — the session store, and later the auth rate-limit counters.
 * Redis on ks-b is shared by every app on the box, so every key Iknos writes is namespaced.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: RedisClientType;
  private connection: Promise<void> = Promise.resolve();

  constructor() {
    this.client = createClient({
      url: process.env.REDIS_URL,
      // Without this, a command issued while the connection is down is queued until it comes
      // back. A request would then hang for as long as Redis is out rather than fail — and a
      // request that never answers is worse than one that answers 500.
      disableOfflineQueue: true,
      socket: {
        // Retry forever with a bounded backoff. Redis being down is a degraded state, not a
        // reason for the API to die: the box reboots, Redis comes back, and the process that
        // stayed up is already reconnected.
        reconnectStrategy: (retries) => Math.min(1000 * 2 ** retries, 30_000),
      },
    });

    // node-redis throws on an unhandled "error" event, which would take the process down with
    // it. Attaching this handler is what turns an outage into a log line.
    this.client.on("error", (error: Error) => {
      this.logger.warn(`Redis unavailable: ${error.message}`);
    });
    this.client.on("ready", () => {
      this.logger.log("Redis connected");
    });
  }

  onModuleInit(): void {
    // Not awaited, and that is the point. With a reconnect strategy that never gives up,
    // `connect()` does not reject when Redis is down — it simply never settles. Awaiting it
    // would hang module init and the API would never reach `listen()`, which is exactly the
    // state a fresh clone with no Redis starts in.
    this.connection = this.client.connect().then(
      () => undefined,
      (error: Error) => {
        this.logger.warn(`Redis not reachable at startup, retrying in background: ${error.message}`);
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.quit();
    }
  }

  /**
   * Resolves once the first connection attempt has settled, successfully or not.
   *
   * For tests, which need a connected client before asserting anything about the keyspace.
   * Deliberately not awaited during bootstrap — see `onModuleInit`.
   */
  ready(): Promise<void> {
    return this.connection;
  }

  getClient(): RedisClientType {
    return this.client;
  }

  /**
   * Destroys every stored session belonging to a user.
   *
   * Called on sign-in, which is what makes "one live session per account" true: the previous
   * cookie stops working the moment a new one is issued.
   *
   * SCAN rather than KEYS: KEYS blocks the Redis event loop for the whole sweep, and this runs
   * on a request path against a Redis shared with every other app on the box.
   */
  async clearSessionsForUser(userId: number): Promise<void> {
    for await (const keys of this.client.scanIterator({ MATCH: `${SESSION_PREFIX}*`, COUNT: 100 })) {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        try {
          const value = await this.client.get(key);
          if (!value) continue;
          const session = JSON.parse(value) as { userId?: number };
          if (session.userId === userId) {
            await this.client.del(key);
          }
        } catch {
          // A malformed or already-deleted entry is not a reason to leave the rest of the
          // user's sessions alive — which is what an uncaught throw here would do.
        }
      }
    }
  }
}
