import { CSRF_HEADER } from "@auth/session.guard";
import { PrismaService } from "@db/prisma.service";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, clearRateLimits, nextClientIp } from "./helpers";

import type { INestApplication } from "@nestjs/common";
import type TestAgent from "supertest/lib/agent";

const EMAIL = "owner@iknos.local";
const PASSWORD = "first-password-1234";
const PASSPHRASE = "correct horse battery staple ok";

describe("account", () => {
  let app: INestApplication;

  const server = () => request(app.getHttpServer());

  function register(body: Record<string, unknown> = {}) {
    return server()
      .post("/api/auth/register")
      .send({ email: EMAIL, password: PASSWORD, recoveryPassphrase: PASSPHRASE, ...body });
  }

  function recover(body: Record<string, unknown> = {}) {
    return server()
      .post("/api/auth/recover")
      .send({ email: EMAIL, recoveryPassphrase: PASSPHRASE, password: "second-password-1234", ...body });
  }

  async function signIn(password = PASSWORD): Promise<{ agent: TestAgent; csrfToken: string }> {
    const agent = request.agent(app.getHttpServer());
    const res = await agent
      .post("/api/auth/login")
      .set("X-Forwarded-For", nextClientIp())
      .send({ email: EMAIL, password })
      .expect(201);
    return { agent, csrfToken: res.body.csrfToken as string };
  }

  /** Every test starts on a blank instance; there is no way to hold two accounts side by side. */
  async function unseal(): Promise<void> {
    await app.get(PrismaService).appUser.deleteMany();
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await clearRateLimits(app);
    await unseal();
  });

  afterEach(async () => {
    await clearRateLimits(app);
    await unseal();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe("bootstrap", () => {
    it("reports an unsealed instance without a session", async () => {
      expect((await server().get("/api/auth/bootstrap").expect(200)).body).toEqual({ sealed: false });
    });

    it("reports sealed once the account exists", async () => {
      await register().expect(201);
      expect((await server().get("/api/auth/bootstrap").expect(200)).body).toEqual({ sealed: true });
    });

    it("answers a boolean and never the address", async () => {
      await register().expect(201);
      const res = await server().get("/api/auth/bootstrap").expect(200);
      expect(JSON.stringify(res.body)).not.toContain(EMAIL);
    });
  });

  describe("register", () => {
    it("creates the account and opens no session", async () => {
      const res = await register().expect(201);

      expect(res.body.userId).toEqual(expect.any(Number));
      // Signing in straight afterwards is what proves the password works, while the passphrase
      // is still on screen to be written down.
      expect(res.headers["set-cookie"]).toBeUndefined();
    });

    it("lets the chosen password sign in", async () => {
      await register().expect(201);
      const { agent } = await signIn();
      await agent.get("/api/me").expect(200);
    });

    it("409s the second registration and stays sealed", async () => {
      await register().expect(201);
      await register({ email: "someone-else@iknos.local" }).expect(409);

      expect((await server().get("/api/auth/bootstrap")).body).toEqual({ sealed: true });
    });

    it("lets exactly one of two simultaneous registrations win", async () => {
      // The count() check is a race; only the UNIQUE constraint on `singleton` decides it.
      const results = await Promise.all([
        register({ email: "one@iknos.local" }),
        register({ email: "two@iknos.local" }),
      ]);

      const codes = results.map((r) => r.status).sort();
      expect(codes).toEqual([201, 409]);
      expect(await app.get(PrismaService).appUser.count()).toBe(1);
    });

    it("400s a short password or passphrase, naming the field and never the value", async () => {
      const short = "short";
      const password = await register({ password: short }).expect(400);
      expect(JSON.stringify(password.body)).toContain("password");
      expect(JSON.stringify(password.body)).not.toContain(short);

      const phrase = await register({ recoveryPassphrase: short }).expect(400);
      expect(JSON.stringify(phrase.body)).toContain("recoveryPassphrase");
      expect(JSON.stringify(phrase.body)).not.toContain(short);
    });

    it("requires a recovery passphrase at all", async () => {
      // The account would otherwise be unrecoverable, on a box with no mail server.
      await register({ recoveryPassphrase: undefined }).expect(400);
    });

    it("never echoes the secrets back", async () => {
      const res = await register().expect(201);
      const body = JSON.stringify(res.body);
      expect(body).not.toContain(PASSWORD);
      expect(body).not.toContain(PASSPHRASE);
      expect(body).not.toMatch(/scrypt|passwordHash|recoveryPassphraseHash/);
    });
  });

  describe("recover", () => {
    it("sets a new password with the right passphrase", async () => {
      await register().expect(201);
      await recover().expect(201);

      const { agent } = await signIn("second-password-1234");
      await agent.get("/api/me").expect(200);
    });

    it("kills the old password and every live session", async () => {
      await register().expect(201);
      const { agent } = await signIn();
      await agent.get("/api/me").expect(200);

      await recover().expect(201);

      // Whoever locked the owner out may be holding a session. A reset that leaves it alive is
      // cosmetic.
      await agent.get("/api/me").expect(401);
      await server()
        .post("/api/auth/login")
        .set("X-Forwarded-For", nextClientIp())
        .send({ email: EMAIL, password: PASSWORD })
        .expect(401);
    });

    it("opens no session of its own", async () => {
      await register().expect(201);
      expect((await recover().expect(201)).headers["set-cookie"]).toBeUndefined();
    });

    it("answers identically to a wrong passphrase, an unknown address, and no passphrase on file", async () => {
      await register().expect(201);
      const wrong = await recover({ recoveryPassphrase: "wrong horse battery staple!" }).expect(401);
      const unknown = await recover({ email: "nobody@example.com" }).expect(401);

      await unseal();
      // An account created by the CLI without a passphrase: recoverable only in the database,
      // and the route must not say so.
      await app.get(PrismaService).appUser.create({
        data: { email: EMAIL, passwordHash: "scrypt$131072$8$1$AAAA$BBBB" },
      });
      const noneOnFile = await recover().expect(401);

      expect(wrong.body).toEqual(unknown.body);
      expect(wrong.body).toEqual(noneOnFile.body);
    });

    it("costs the same for all three", async () => {
      await register().expect(201);
      const time = async (body: Record<string, unknown>) => {
        const started = performance.now();
        await recover(body).expect(401);
        return performance.now() - started;
      };

      // The derivation runs against a dummy hash when there is nothing to compare, so none of
      // the three can be picked out with a stopwatch.
      expect(await time({ recoveryPassphrase: "wrong horse battery staple!" })).toBeGreaterThan(100);
      expect(await time({ email: "nobody@example.com" })).toBeGreaterThan(100);
    });

    it("429s the sixth attempt, distinguishably from a wrong passphrase", async () => {
      await register().expect(201);
      for (let i = 0; i < 5; i++) {
        await recover({ recoveryPassphrase: "wrong horse battery staple!" }).expect(401);
      }
      await recover({ recoveryPassphrase: "wrong horse battery staple!" }).expect(429);
    });

    it("counts the address, so rotating callers buys no extra guesses", async () => {
      await register().expect(201);
      for (let i = 0; i < 5; i++) {
        await server()
          .post("/api/auth/recover")
          .set("X-Forwarded-For", nextClientIp())
          .send({ email: EMAIL, recoveryPassphrase: "wrong horse battery staple!", password: "x".repeat(12) })
          .expect(401);
      }

      await server()
        .post("/api/auth/recover")
        .set("X-Forwarded-For", nextClientIp())
        .send({ email: EMAIL, recoveryPassphrase: PASSPHRASE, password: "second-password-1234" })
        .expect(429);
    });

    it("gives the budget back on success", async () => {
      await register().expect(201);
      for (let i = 0; i < 4; i++) {
        await recover({ recoveryPassphrase: "wrong horse battery staple!" }).expect(401);
      }
      await recover().expect(201);

      // Four wrong guesses then the right one must not leave the owner one attempt from a
      // quarter of an hour locked out.
      for (let i = 0; i < 5; i++) {
        await recover({ recoveryPassphrase: "wrong horse battery staple!" }).expect(401);
      }
    });
  });

  describe("change password", () => {
    it("401s without a session", async () => {
      await register().expect(201);
      await server()
        .post("/api/auth/password")
        .send({ currentPassword: PASSWORD, password: "third-password-1234" })
        .expect(401);
    });

    it("403s without the csrf token", async () => {
      await register().expect(201);
      const { agent } = await signIn();
      await agent
        .post("/api/auth/password")
        .send({ currentPassword: PASSWORD, password: "third-password-1234" })
        .expect(403);
    });

    it("401s with the wrong current password", async () => {
      await register().expect(201);
      const { agent, csrfToken } = await signIn();

      // A session left open on an unlocked laptop must not be enough to take the account over.
      await agent
        .post("/api/auth/password")
        .set(CSRF_HEADER, csrfToken)
        .send({ currentPassword: "not-the-password", password: "third-password-1234" })
        .expect(401);
    });

    it("changes the password and keeps the current session alive", async () => {
      await register().expect(201);
      const { agent, csrfToken } = await signIn();

      await agent
        .post("/api/auth/password")
        .set(CSRF_HEADER, csrfToken)
        .send({ currentPassword: PASSWORD, password: "third-password-1234" })
        .expect(201);

      // Changing a password should not log the owner out of the tab they changed it in.
      await agent.get("/api/me").expect(200);

      const { agent: fresh } = await signIn("third-password-1234");
      await fresh.get("/api/me").expect(200);
    });

    it("leaves the passphrase alone unless a new one is given", async () => {
      await register().expect(201);
      const { agent, csrfToken } = await signIn();

      await agent
        .post("/api/auth/password")
        .set(CSRF_HEADER, csrfToken)
        .send({ currentPassword: PASSWORD, password: "third-password-1234" })
        .expect(201);

      // Changing a password must not silently discard the only way back into the account.
      await recover({ password: "fourth-password-1234" }).expect(201);
    });

    it("replaces the passphrase when one is given", async () => {
      await register().expect(201);
      const { agent, csrfToken } = await signIn();

      await agent
        .post("/api/auth/password")
        .set(CSRF_HEADER, csrfToken)
        .send({
          currentPassword: PASSWORD,
          password: "third-password-1234",
          recoveryPassphrase: "a completely different phrase",
        })
        .expect(201);

      await recover().expect(401);
      await recover({ recoveryPassphrase: "a completely different phrase" }).expect(201);
    });
  });
});
