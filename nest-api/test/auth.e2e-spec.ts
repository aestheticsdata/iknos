import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CSRF_HEADER } from "../src/auth/session.guard";
import { PrismaService } from "../src/prisma/prisma.service";
import { RedisService } from "../src/redis/redis.service";
import { buildTestApp, clearRateLimits, nextClientIp, seedTestAccount, TEST_EMAIL, TEST_PASSWORD } from "./helpers";

import type { INestApplication } from "@nestjs/common";
import type TestAgent from "supertest/lib/agent";

describe("auth", () => {
  let app: INestApplication;
  let userId: number;

  async function login(password = TEST_PASSWORD): Promise<{ agent: TestAgent; body: Record<string, unknown> }> {
    const agent = request.agent(app.getHttpServer());
    const res = await agent
      .post("/api/auth/login")
      .set("X-Forwarded-For", nextClientIp())
      .send({ email: TEST_EMAIL, password });
    return { agent, body: res.body };
  }

  beforeAll(async () => {
    app = await buildTestApp();
    userId = await seedTestAccount(app);
    await clearRateLimits(app);
  });

  afterAll(async () => {
    await app?.get(RedisService).clearSessionsForUser(userId);
    await clearRateLimits(app);
    // Leaves the instance unsealed. Otherwise the next `pnpm seed:user` fails on the singleton
    // constraint and reads as a broken CLI rather than as leftover test data.
    await app?.get(PrismaService).appUser.deleteMany();
    await app?.close();
  });

  describe("login", () => {
    it("returns the same answer for a wrong password and an account that does not exist", async () => {
      const server = request(app.getHttpServer());
      const wrongPassword = await server
        .post("/api/auth/login")
        .set("X-Forwarded-For", nextClientIp())
        .send({ email: TEST_EMAIL, password: "definitely-not-the-password" })
        .expect(401);

      const noSuchAccount = await server
        .post("/api/auth/login")
        .set("X-Forwarded-For", nextClientIp())
        .send({ email: "nobody@example.com", password: "definitely-not-the-password" })
        .expect(401);

      expect(wrongPassword.body).toEqual(noSuchAccount.body);
      // Nothing in the body may hint that the address was the part that was wrong.
      expect(JSON.stringify(noSuchAccount.body)).not.toMatch(/email|account|user|exist/i);
      expect(noSuchAccount.headers["set-cookie"]).toBeUndefined();
    });

    it("costs the same whether or not the account exists", async () => {
      const server = request(app.getHttpServer());
      const time = async (email: string) => {
        const started = performance.now();
        await server
          .post("/api/auth/login")
          .set("X-Forwarded-For", nextClientIp())
          .send({ email, password: "definitely-not-the-password" })
          .expect(401);
        return performance.now() - started;
      };

      const missing = await time("nobody@example.com");
      const existing = await time(TEST_EMAIL);

      // Both derive against a real hash, so both pay ~300ms. An early return on the missing
      // account would land near zero and turn "is this the right address" into a stopwatch
      // question. Generous bounds: this asserts the derivation happened, not a constant.
      expect(missing).toBeGreaterThan(100);
      expect(existing).toBeGreaterThan(100);
    });

    it("issues a hardened cookie and a csrf token on success", async () => {
      const agent = request.agent(app.getHttpServer());
      const res = await agent
        .post("/api/auth/login")
        .set("X-Forwarded-For", nextClientIp())
        .send({ email: TEST_EMAIL, password: TEST_PASSWORD })
        .expect(201);

      const cookie = (res.headers["set-cookie"] as unknown as string[])[0];
      expect(cookie).toMatch(/^iknos\.sid=s%3A/);
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).toContain("Path=/");

      expect(res.body.userId).toBe(userId);
      expect(res.body.csrfToken).toHaveLength(43);
      // Never the address, never the hash.
      expect(JSON.stringify(res.body)).not.toContain(TEST_EMAIL);
      expect(JSON.stringify(res.body)).not.toMatch(/scrypt|passwordHash/);
    });

    it("accepts the address in any case", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/auth/login")
        .set("X-Forwarded-For", nextClientIp())
        .send({ email: TEST_EMAIL.toUpperCase(), password: TEST_PASSWORD })
        .expect(201);

      expect(res.body.userId).toBe(userId);
    });

    it("rejects a malformed address before it costs a derivation", async () => {
      await request(app.getHttpServer())
        .post("/api/auth/login")
        .set("X-Forwarded-For", nextClientIp())
        .send({ email: "not-an-address", password: TEST_PASSWORD })
        .expect(400);
    });

    it("invalidates the previous session", async () => {
      const first = await login();
      await first.agent.get("/api/me").expect(200);

      await login();

      // One live session per account. The first cookie must be dead, not merely older.
      await first.agent.get("/api/me").expect(401);
    });

    it("issues a new session id on login", async () => {
      const agent = request.agent(app.getHttpServer());
      const before = await agent.get("/api/csrf").expect(401);
      expect(before.headers["set-cookie"]).toBeUndefined();

      const res = await agent
        .post("/api/auth/login")
        .set("X-Forwarded-For", nextClientIp())
        .send({ email: TEST_EMAIL, password: TEST_PASSWORD })
        .expect(201);

      // Regenerated rather than adopted: a session id that predates the login is one somebody
      // else may already know.
      expect(res.headers["set-cookie"]).toBeDefined();
    });
  });

  describe("rate limit", () => {
    it("429s the sixth attempt in a minute, and says so distinguishably", async () => {
      const ip = nextClientIp();
      const attempt = () =>
        request(app.getHttpServer())
          .post("/api/auth/login")
          .set("X-Forwarded-For", ip)
          .send({ email: TEST_EMAIL, password: "definitely-not-the-password" });

      for (let i = 0; i < 5; i++) await attempt().expect(401);
      await attempt().expect(429);
    });

    it("counts per client, not globally", async () => {
      const ip = nextClientIp();
      for (let i = 0; i < 6; i++) {
        await request(app.getHttpServer())
          .post("/api/auth/login")
          .set("X-Forwarded-For", ip)
          .send({ email: TEST_EMAIL, password: "definitely-not-the-password" });
      }

      // Everyone shares one nginx. If the counter were global, one attacker would lock the
      // owner out of their own console.
      await request(app.getHttpServer())
        .post("/api/auth/login")
        .set("X-Forwarded-For", nextClientIp())
        .send({ email: TEST_EMAIL, password: TEST_PASSWORD })
        .expect(201);
    });

    it("gives the budget back after a successful login", async () => {
      const ip = nextClientIp();
      const post = (password: string) =>
        request(app.getHttpServer()).post("/api/auth/login").set("X-Forwarded-For", ip).send({
          email: TEST_EMAIL,
          password,
        });

      for (let i = 0; i < 4; i++) await post("definitely-not-the-password").expect(401);
      await post(TEST_PASSWORD).expect(201);

      // Four typos then a success must not leave the owner one attempt from a lockout.
      for (let i = 0; i < 5; i++) await post("definitely-not-the-password").expect(401);
    });
  });

  describe("session routes", () => {
    it("401s /api/me and /api/csrf without a session", async () => {
      for (const url of ["/api/me", "/api/csrf"]) {
        await request(app.getHttpServer()).get(url).expect(401);
      }
    });

    it("returns the user id and a stable csrf token to a session", async () => {
      const { agent, body } = await login();

      expect((await agent.get("/api/me").expect(200)).body).toEqual({ userId });
      // The same token the login handed out — a second one would invalidate the first.
      expect((await agent.get("/api/csrf").expect(200)).body).toEqual({ csrfToken: body.csrfToken });
    });

    it("403s logout without the csrf token, and logs out with it", async () => {
      const { agent, body } = await login();

      // 403 and not 401: the session is fine, the forgery protection is not.
      await agent.post("/api/auth/logout").expect(403);
      await agent.get("/api/me").expect(200);

      await agent
        .post("/api/auth/logout")
        .set(CSRF_HEADER, body.csrfToken as string)
        .expect(201);
      await agent.get("/api/me").expect(401);
    });

    it("destroys the redis record on logout, not just the cookie", async () => {
      const { agent, body } = await login();
      await agent
        .post("/api/auth/logout")
        .set(CSRF_HEADER, body.csrfToken as string)
        .expect(201);

      // Clearing the cookie alone would leave a live session anyone holding the old value could
      // keep using — which is the entire difference between logging out and hiding the key.
      const keys = await app.get(RedisService).getClient().keys("iknos:sess:*");
      const sessions = await Promise.all(keys.map((key) => app.get(RedisService).getClient().get(key)));
      expect(sessions.filter((s) => s?.includes(`"userId":${userId}`))).toHaveLength(0);
    });
  });
});
