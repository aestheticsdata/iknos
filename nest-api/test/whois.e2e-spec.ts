import { WHOIS_REASON, WHOIS_STATUS } from "@contracts/whois";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, login } from "./helpers";

import type { IpWhois } from "@contracts/whois";
import type { INestApplication } from "@nestjs/common";

/**
 * The route as mounted (IKN-73). Only addresses that never leave the box are asked here — a
 * private one is answered locally and a malformed one is refused before any lookup — so the suite
 * opens no socket to the provider. The provider half is `whois.service.spec.ts`, against a counted
 * fake.
 */

let app: INestApplication;
let cookie: string;

beforeAll(async () => {
  app = await buildTestApp();
  cookie = await login(app);
});

afterAll(async () => {
  await app?.close();
});

describe("GET /api/whois/:ip", () => {
  it("refuses a caller with no session", async () => {
    await request(app.getHttpServer()).get("/api/whois/8.8.8.8").expect(401);
  });

  it("answers a private address as unknown, on the box", async () => {
    const res = await request(app.getHttpServer()).get("/api/whois/127.0.0.1").set("Cookie", cookie).expect(200);

    expect(res.body as IpWhois).toMatchObject({
      ip: "127.0.0.1",
      status: WHOIS_STATUS.unknown,
      reason: WHOIS_REASON.private,
    });
  });

  it("is a 400 naming the parameter for something that is not an address", async () => {
    const res = await request(app.getHttpServer()).get("/api/whois/not-an-ip").set("Cookie", cookie).expect(400);

    expect(res.body.message).toMatch(/'ip'/);
  });
});
