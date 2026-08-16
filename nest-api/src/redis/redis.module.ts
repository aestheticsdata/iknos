import { Global, Module } from "@nestjs/common";
import { RedisService } from "./redis.service";

/**
 * Global, like `PrismaModule`: one client per process, injectable anywhere without every
 * feature module having to import it. `main.ts` also pulls it out of the container to hand the
 * raw client to `RedisStore` before the first request.
 */
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
