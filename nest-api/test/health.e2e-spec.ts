import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";

import type { INestApplication } from "@nestjs/common";

describe("health", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("is public and reveals nothing", async () => {
    const res = await request(app.getHttpServer()).get("/health").expect(200);

    expect(res.body).toEqual({ status: "ok" });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("version");
    expect(body).not.toContain("hostname");
  });

  // Locks in a decision rather than testing behaviour. Patching BigInt.prototype.toJSON looks
  // like a one-line fix for `LogEntry.id`, and it silently turns every BigInt anywhere into a
  // string — including where the throw was the thing you wanted. Task 17 maps id at the DTO
  // boundary instead.
  it("BigInt is not globally patched", () => {
    expect(() => JSON.stringify({ n: 1n })).toThrow(TypeError);
  });
});
