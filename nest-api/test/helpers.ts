import { ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module";
import { hashPassword } from "../src/auth/password.util";
import { buildSessionMiddleware } from "../src/auth/session.middleware";
import { PrismaService } from "../src/prisma/prisma.service";
import { RedisService } from "../src/redis/redis.service";

import type { INestApplication } from "@nestjs/common";
import type { Application } from "express";

export const TEST_EMAIL = "test@iknos.local";
export const TEST_PASSWORD = "test-password-1234";

const SECRET = "test-secret-at-least-as-long-as-the-real-one-which-is-sixty-four-plus";

/**
 * The app as `main.ts` assembles it — same middleware, same order, same pipe.
 *
 * Anything configured here but not there (or the reverse) is a property the tests prove about a
 * program that does not ship.
 */
export async function buildTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();

  // So `X-Forwarded-For` reaches `req.ip` and the rate-limit tests can pose as distinct clients.
  (app.getHttpAdapter().getInstance() as Application).set("trust proxy", 1);
  app.use(buildSessionMiddleware(app.get(RedisService).getClient(), SECRET, false));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

  await app.init();
  await app.get(RedisService).ready();
  return app;
}

/**
 * Replaces the account.
 *
 * **This suite owns `app_user`.** `singleton` is UNIQUE, so there is no way to add a test
 * account beside a real one — running these tests deletes whatever local account exists, and
 * `pnpm seed:user` recreates it. That is a local development database only; ks-b runs
 * `migrate deploy` and never this.
 */
export async function seedTestAccount(app: INestApplication): Promise<number> {
  const prisma = app.get(PrismaService);
  await prisma.appUser.deleteMany();

  const user = await prisma.appUser.create({
    data: { email: TEST_EMAIL, passwordHash: await hashPassword(TEST_PASSWORD) },
  });
  return user.id;
}

/** Distinct per call, so one test's exhausted rate-limit budget is not another's starting point. */
let clientCounter = 0;
export function nextClientIp(): string {
  clientCounter += 1;
  return `203.0.113.${clientCounter % 250}`;
}

/**
 * Drops every login counter before the suite starts.
 *
 * The addresses above repeat from run to run, and the counters live for a minute — so a second
 * `pnpm test` inside that minute starts with the budget already spent and the rate-limit tests
 * fail for a reason that has nothing to do with the code. Found exactly that way.
 */
export async function clearRateLimits(app: INestApplication): Promise<void> {
  const client = app.get(RedisService).getClient();
  const keys = await client.keys("iknos:rl:*");
  if (keys.length > 0) await client.del(keys);
}
