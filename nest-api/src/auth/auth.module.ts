import { Module } from "@nestjs/common";
import { AccountController } from "./account.controller";
import { AuthController } from "./auth.controller";
import { RateLimitService } from "./ratelimit.service";
import { UsersService } from "./users.service";

/**
 * `PrismaModule` and `RedisModule` are both `@Global`, so nothing needs importing here.
 *
 * `SessionGuard` is deliberately absent: it is registered once as `APP_GUARD` in `AppModule`,
 * because a guard listed by a feature module protects only that module's routes.
 */
@Module({
  controllers: [AuthController, AccountController],
  providers: [UsersService, RateLimitService],
  // `RateLimitService` is exported for the ingestion route (IKN-29), which is `@Public()` and
  // therefore needs its own ceiling. One service rather than two: the budgets are separate
  // scopes in the same Redis keyspace, so they cannot drift on how a window is counted.
  exports: [UsersService, RateLimitService],
})
export class AuthModule {}
