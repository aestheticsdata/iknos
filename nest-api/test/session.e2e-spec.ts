import { Controller, Get, Module, Param, ParseIntPipe, Post, Req } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from "../src/auth/session.constants";
import { buildSessionMiddleware } from "../src/auth/session.middleware";
import { RedisService, SESSION_PREFIX } from "../src/redis/redis.service";

import type { INestApplication } from "@nestjs/common";
import type { Application, Request } from "express";
import type { RedisClientType } from "redis";

/**
 * One id per test, never shared.
 *
 * `findSessionKey` looks a session up by the user it belongs to, so two tests logging in as the
 * same user leave two matching keys and the lookup returns whichever the SCAN reaches first —
 * which is how a sliding-TTL assertion ends up measuring a session nobody touched.
 */
const USER = {
  cookieFlags: 424_201,
  carries: 424_202,
  stored: 424_203,
  sliding: 424_204,
  cleared: 424_205,
  secure: 424_206,
} as const;

const SECRET = "test-secret-at-least-as-long-as-the-real-one-which-is-sixty-four-plus";

/**
 * Two routes that exist only here: enough to put something in a session and read it back, which
 * is all Task 8 has to prove. The real login arrives in Task 10 and the guard in Task 9 — until
 * then these are deliberately unprotected.
 */
@Controller("test-session")
class SessionProbeController {
  @Post("login/:userId")
  login(@Req() req: Request, @Param("userId", ParseIntPipe) userId: number) {
    req.session.userId = userId;
    return { ok: true };
  }

  @Get("whoami")
  whoami(@Req() req: Request) {
    return { userId: req.session.userId ?? null };
  }
}

/** No AppModule, so no database: the Secure-cookie assertion needs a session and nothing else. */
@Module({ controllers: [SessionProbeController] })
class ProbeModule {}

/** The sid is only in the cookie in signed, url-encoded form; the keyspace is easier to ask. */
async function findSessionKey(client: RedisClientType, userId: number): Promise<string | null> {
  for await (const keys of client.scanIterator({ MATCH: `${SESSION_PREFIX}*`, COUNT: 100 })) {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      const value = await client.get(key);
      if (!value) continue;
      try {
        if ((JSON.parse(value) as { userId?: number }).userId === userId) return key;
      } catch {
        // Not ours.
      }
    }
  }
  return null;
}

describe("session", () => {
  let app: INestApplication;
  let redis: RedisService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [SessionProbeController],
    }).compile();

    app = moduleRef.createNestApplication();
    redis = app.get(RedisService);
    // Before init, so the middleware sits ahead of the routes — the same order as main.ts.
    app.use(buildSessionMiddleware(redis.getClient(), SECRET, false));
    await app.init();
    await redis.ready();
  });

  afterAll(async () => {
    for (const userId of Object.values(USER)) {
      await redis?.clearSessionsForUser(userId);
    }
    await app?.close();
  });

  it("issues no cookie and writes no key for a request that stores nothing", async () => {
    const res = await request(app.getHttpServer()).get("/test-session/whoami").expect(200);

    // saveUninitialized: false. An unauthenticated probe must not be able to fill a Redis
    // shared with every other app on the box.
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(res.body).toEqual({ userId: null });
  });

  it("sets an httpOnly, SameSite=Lax cookie once the session holds something", async () => {
    const res = await request(app.getHttpServer()).post(`/test-session/login/${USER.cookieFlags}`).expect(201);

    const cookie = (res.headers["set-cookie"] as unknown as string[])[0];
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    // Signed: express-session prefixes the value with `s:` and appends the signature.
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=s%3A`);
  });

  it("carries the session across requests", async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post(`/test-session/login/${USER.carries}`).expect(201);

    const res = await agent.get("/test-session/whoami").expect(200);
    expect(res.body).toEqual({ userId: USER.carries });
  });

  it("stores the session in Redis under the iknos prefix, with the 2h ttl", async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post(`/test-session/login/${USER.stored}`).expect(201);

    const key = await findSessionKey(redis.getClient(), USER.stored);
    expect(key).not.toBeNull();
    expect(key).toContain(SESSION_PREFIX);

    const ttl = await redis.getClient().ttl(key as string);
    expect(ttl).toBeGreaterThan(SESSION_TTL_SECONDS - 60);
    expect(ttl).toBeLessThanOrEqual(SESSION_TTL_SECONDS);
  });

  it("slides the ttl on every request", async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post(`/test-session/login/${USER.sliding}`).expect(201);
    const key = (await findSessionKey(redis.getClient(), USER.sliding)) as string;

    // Stand in for two hours minus ten seconds of inactivity.
    await redis.getClient().expire(key, 10);
    await agent.get("/test-session/whoami").expect(200);

    expect(await redis.getClient().ttl(key)).toBeGreaterThan(SESSION_TTL_SECONDS - 60);
  });

  it("stops honouring the cookie once the user's sessions are cleared", async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post(`/test-session/login/${USER.cleared}`).expect(201);
    expect((await agent.get("/test-session/whoami")).body).toEqual({ userId: USER.cleared });

    // What a fresh login will call: the previous cookie has to stop working, which is the whole
    // of "one live session per account".
    await redis.clearSessionsForUser(USER.cleared);

    expect((await agent.get("/test-session/whoami")).body).toEqual({ userId: null });
  });

  describe("behind nginx", () => {
    let secureApp: INestApplication;

    beforeAll(async () => {
      secureApp = await NestFactory.create(ProbeModule, { logger: false });
      // Without this, express sees a plain-HTTP request on loopback and silently declines to
      // set a Secure cookie — so the session would never survive the first hop in production.
      (secureApp.getHttpAdapter().getInstance() as Application).set("trust proxy", 1);
      secureApp.use(buildSessionMiddleware(redis.getClient(), SECRET, true));
      await secureApp.init();
    });

    afterAll(async () => {
      await secureApp?.close();
    });

    it("marks the cookie Secure when nginx forwarded https", async () => {
      const res = await request(secureApp.getHttpServer())
        .post(`/test-session/login/${USER.secure}`)
        .set("X-Forwarded-Proto", "https")
        .expect(201);

      expect((res.headers["set-cookie"] as unknown as string[])[0]).toContain("Secure");
    });
  });
});
