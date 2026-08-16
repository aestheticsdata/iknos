import { randomBytes } from "node:crypto";
import { Controller, Delete, Get, Param, ParseIntPipe, Post, Req } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { Public } from "../src/auth/public.decorator";
import { CSRF_HEADER } from "../src/auth/session.guard";
import { buildSessionMiddleware } from "../src/auth/session.middleware";
import { RedisService } from "../src/redis/redis.service";

import type { INestApplication } from "@nestjs/common";
import type { Request } from "express";
import type TestAgent from "supertest/lib/agent";

const USER_ID = 424_301;
const SECRET = "test-secret-at-least-as-long-as-the-real-one-which-is-sixty-four-plus";

/** Stands in for Task 10's login: the only thing here that is allowed to run without a session. */
@Public()
@Controller("test-guard")
class GuardLoginController {
  @Post("login/:userId")
  login(@Req() req: Request, @Param("userId", ParseIntPipe) userId: number) {
    req.session.userId = userId;
    req.session.csrfToken = randomBytes(32).toString("base64url");
    return { csrfToken: req.session.csrfToken };
  }
}

/**
 * Carries no decorator of any kind — which is the entire point.
 *
 * This is the controller a future task adds without thinking about auth. If it answers anything
 * other than 401 to an anonymous caller, the guard is not global and every route added from here
 * on is public until someone notices.
 */
@Controller("test-protected")
class ProtectedController {
  @Get("ping")
  ping(@Req() req: Request) {
    return { userId: req.session.userId };
  }

  @Post("mutate")
  mutate() {
    return { mutated: true };
  }

  @Delete("thing")
  remove() {
    return { removed: true };
  }
}

describe("session guard", () => {
  let app: INestApplication;
  let redis: RedisService;

  async function login(): Promise<{ agent: TestAgent; csrfToken: string }> {
    const agent = request.agent(app.getHttpServer());
    const res = await agent.post(`/test-guard/login/${USER_ID}`).expect(201);
    return { agent, csrfToken: res.body.csrfToken as string };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [GuardLoginController, ProtectedController],
    }).compile();

    app = moduleRef.createNestApplication();
    redis = app.get(RedisService);
    app.use(buildSessionMiddleware(redis.getClient(), SECRET, false));
    await app.init();
    await redis.ready();
  });

  afterAll(async () => {
    await redis?.clearSessionsForUser(USER_ID);
    await app?.close();
  });

  describe("default deny", () => {
    it("refuses an anonymous read of a controller nobody decorated", async () => {
      await request(app.getHttpServer()).get("/test-protected/ping").expect(401);
    });

    it("refuses an anonymous write before it ever looks at the csrf token", async () => {
      // 401 and not 403: an anonymous caller has no session, so there is no token to compare
      // against. Answering 403 here would say "your token was wrong" to someone who has none.
      await request(app.getHttpServer()).post("/test-protected/mutate").expect(401);
    });

    it("refuses a cookie that is not ours", async () => {
      await request(app.getHttpServer())
        .get("/test-protected/ping")
        .set("Cookie", "iknos.sid=s%3Anot-a-real-session.and-not-a-real-signature")
        .expect(401);
    });
  });

  describe("@Public()", () => {
    it("lets /health through with no session", async () => {
      const res = await request(app.getHttpServer()).get("/health").expect(200);
      expect(res.body).toEqual({ status: "ok" });
    });

    it("lets the login route through with no session", async () => {
      const { csrfToken } = await login();
      expect(csrfToken).toHaveLength(43);
    });
  });

  describe("with a session", () => {
    it("allows a safe verb without any csrf token", async () => {
      const { agent } = await login();
      const res = await agent.get("/test-protected/ping").expect(200);
      expect(res.body).toEqual({ userId: USER_ID });
    });

    it("rejects an unsafe verb carrying no csrf token", async () => {
      const { agent } = await login();
      await agent.post("/test-protected/mutate").expect(403);
    });

    it("rejects an unsafe verb carrying the wrong csrf token", async () => {
      const { agent, csrfToken } = await login();
      // Same length, one byte different — the case a length check alone would wave through.
      const wrong = `${csrfToken.slice(0, -1)}${csrfToken.endsWith("A") ? "B" : "A"}`;
      await agent.post("/test-protected/mutate").set(CSRF_HEADER, wrong).expect(403);
    });

    it("accepts an unsafe verb carrying the right csrf token", async () => {
      const { agent, csrfToken } = await login();
      const res = await agent.post("/test-protected/mutate").set(CSRF_HEADER, csrfToken).expect(201);
      expect(res.body).toEqual({ mutated: true });
    });

    it("applies the csrf check to every unsafe verb, not just POST", async () => {
      const { agent, csrfToken } = await login();

      await agent.delete("/test-protected/thing").expect(403);
      await agent.delete("/test-protected/thing").set(CSRF_HEADER, csrfToken).expect(200);
    });
  });
});
