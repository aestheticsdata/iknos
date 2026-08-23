import { randomUUID } from "node:crypto";
import { hashPassword } from "@auth/password.util";
import { buildSessionMiddleware } from "@auth/session.middleware";
import { JSON_BODY_LIMIT } from "@config/body-limit";
import { PrismaService } from "@db/prisma.service";
import { buildIngestCors } from "@ingest/ingest-cors";
import { persistBatch } from "@ingest/writer";
import { ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { RedisService } from "@redis/redis.service";
import { AppModule } from "@src/app.module";
import request from "supertest";

import type { LogRecord } from "@ingest/log-record";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Application } from "express";

export const TEST_EMAIL = "test@iknos.local";
export const TEST_PASSWORD = "test-password-1234";

const SECRET = "test-secret-at-least-as-long-as-the-real-one-which-is-sixty-four-plus";

/**
 * The same split `parseEnv` applies, read at app-build time — after a suite's `beforeAll` has
 * placed its origins in the environment, exactly like the controller reads its token.
 */
function parseIngestOrigins(): string[] {
  return (process.env.IKNOS_INGEST_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * The app as `main.ts` assembles it — same middleware, same order, same pipe.
 *
 * Anything configured here but not there (or the reverse) is a property the tests prove about a
 * program that does not ship.
 */
export async function buildTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();

  // So `X-Forwarded-For` reaches `req.ip` and the rate-limit tests can pose as distinct clients.
  (app.getHttpAdapter().getInstance() as Application).set("trust proxy", 1);
  // Same order as `main.ts`: CORS ahead of the session, reading the same environment the
  // controller reads its token from.
  app.use(buildIngestCors(parseIngestOrigins()));
  app.use(buildSessionMiddleware(app.get(RedisService).getClient(), SECRET, false));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  // Ahead of `init`, exactly as `main.ts` puts it ahead of `listen` — a body ceiling the tests
  // assert and the program does not have would be worth nothing.
  app.useBodyParser("json", { limit: JSON_BODY_LIMIT });

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

/**
 * Creates the account, signs in, and returns the `Cookie` header for it.
 *
 * Call it **once per suite**, not once per test: logging in clears every other session for the
 * account (one live session per account, by design), so a second call silently invalidates the
 * cookie the first one handed out.
 */
export async function login(app: INestApplication): Promise<string> {
  await seedTestAccount(app);
  await clearRateLimits(app);

  const res = await request(app.getHttpServer())
    .post("/api/auth/login")
    .set("X-Forwarded-For", nextClientIp())
    .send({ email: TEST_EMAIL, password: TEST_PASSWORD })
    .expect(201);

  const setCookie = res.headers["set-cookie"];
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!header) throw new Error("login returned no session cookie");

  return header.split(";")[0];
}

export type SeedOptions = {
  /** Defaults to `line <i>`. */
  message?: (i: number) => string;
  /** Defaults to info. */
  level?: (i: number) => number;
  /** Defaults to one row per second going back from `base`. */
  ts?: (i: number) => Date;
  traceId?: (i: number) => string | null;
  route?: (i: number) => string | null;
  statusCode?: (i: number) => number | null;
  durationMs?: (i: number) => number | null;
  clientIp?: (i: number) => string | null;
  userId?: (i: number) => string | null;
  hostname?: (i: number) => string | null;
  attrs?: (i: number) => Record<string, unknown> | null;
};

const LEVEL_NAMES: Record<number, string> = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal",
};

/**
 * Inserts `count` rows under a service name nobody else uses, and returns that name.
 *
 * A fresh name per call is what keeps these tests independent of each other and of whatever the
 * local collector has been tailing: every assertion filters on it, and the teardown deletes by
 * it. `log_entry` is the one table these suites do **not** own.
 *
 * Rows go in through `persistBatch`, the collector's own writer, so a seeded row is byte for byte
 * what ingestion would have produced rather than a hand-built approximation.
 */
export async function seedLogs(app: INestApplication, count: number, options: SeedOptions = {}): Promise<string> {
  const service = `t${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const base = Date.UTC(2026, 7, 9, 12, 0, 0);

  const records: LogRecord[] = Array.from({ length: count }, (_, i) => {
    const level = options.level?.(i) ?? 30;
    return {
      ts: options.ts?.(i) ?? new Date(base - i * 1000),
      service,
      level,
      levelName: LEVEL_NAMES[level] ?? "info",
      logger: null,
      message: options.message?.(i) ?? `line ${i}`,
      traceId: options.traceId?.(i) ?? null,
      httpMethod: null,
      route: options.route?.(i) ?? null,
      statusCode: options.statusCode?.(i) ?? null,
      durationMs: options.durationMs?.(i) ?? null,
      clientIp: options.clientIp?.(i) ?? null,
      userId: options.userId?.(i) ?? null,
      hostname: options.hostname?.(i) ?? null,
      attrs: options.attrs?.(i) ?? null,
    };
  });

  await persistBatch(app.get(PrismaService), records, []);
  return service;
}

export async function deleteLogs(app: INestApplication, services: string[]): Promise<void> {
  if (services.length === 0) return;
  await app.get(PrismaService).logEntry.deleteMany({ where: { service: { in: services } } });
}
