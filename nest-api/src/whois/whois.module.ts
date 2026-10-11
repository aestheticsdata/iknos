import { Module } from "@nestjs/common";
import { RedisService } from "@redis/redis.service";
import { WhoisController } from "./whois.controller";
import { WhoisService } from "./whois.service";

import type { WhoisCache } from "./interfaces/whois-types";

/**
 * On-demand whois for the Logs view (IKN-73).
 *
 * Built by a factory, like `ScrapeService`: the cache and the fetch are plain functions rather
 * than providers, and handing them in is what lets the spec count external calls without a socket.
 * `RedisModule` is global, so the client is simply injected.
 */
@Module({
  controllers: [WhoisController],
  providers: [
    {
      provide: WhoisService,
      useFactory: (redis: RedisService) => new WhoisService(redisCache(redis), fetch),
      inject: [RedisService],
    },
  ],
})
export class WhoisModule {}

function redisCache(redis: RedisService): WhoisCache {
  return {
    get: (key) => redis.getClient().get(key),
    set: async ({ key, value, ttlSeconds }) => {
      await redis.getClient().set(key, value, { EX: ttlSeconds });
    },
  };
}
