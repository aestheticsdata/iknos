import {
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SliController } from "./sli.controller";

import type { PrismaService } from "@db/prisma.service";
import type { Request } from "express";
import type { SliService } from "./sli.service";

const ENV = {
  DATABASE_URL: "mysql://x/y",
  REDIS_URL: "redis://x",
  IKNOS_PORT: "4310",
  IKNOS_LOG_LEVEL: "info",
  IKNOS_COOKIE_SECRET: "k".repeat(64),
  IKNOS_RETENTION_DAYS: "14",
  IKNOS_PM2_LOG_GLOB: "/tmp/*.log",
};

const TOKEN = "t".repeat(32);
const QUERY = { service: "atlas-front", from: "2026-11-12T10:00:00Z", to: "2026-11-12T10:10:00Z" };

const asRequest = (authorization?: string) => ({ headers: { authorization } }) as unknown as Request;

describe("SliController", () => {
  const saved = { ...process.env };
  const window = vi.fn();
  const findFirst = vi.fn();

  const build = () =>
    new SliController({ service: { findFirst } } as unknown as PrismaService, { window } as unknown as SliService);

  beforeEach(() => {
    Object.assign(process.env, ENV, { IKNOS_SLI_TOKEN: TOKEN });
    window.mockReset().mockResolvedValue({ requests: 0 });
    findFirst.mockReset().mockResolvedValue({ logGlob: null, hosts: "atlas.example.net" });
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it("answers 503 when no token is configured, whatever the caller sends", async () => {
    delete process.env.IKNOS_SLI_TOKEN;
    await expect(build().window(QUERY, asRequest(`Bearer ${TOKEN}`))).rejects.toThrow(ServiceUnavailableException);
  });

  it("answers 401 to a missing, malformed or wrong token", async () => {
    const controller = build();
    await expect(controller.window(QUERY, asRequest())).rejects.toThrow(UnauthorizedException);
    await expect(controller.window(QUERY, asRequest(TOKEN))).rejects.toThrow(UnauthorizedException);
    await expect(controller.window(QUERY, asRequest(`Bearer ${"x".repeat(32)}`))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(window).not.toHaveBeenCalled();
  });

  it("answers 404 for a service the registry does not have", async () => {
    findFirst.mockResolvedValue(null);
    await expect(build().window(QUERY, asRequest(`Bearer ${TOKEN}`))).rejects.toThrow(NotFoundException);
  });

  it("answers 422 for a service with no access log to measure", async () => {
    findFirst.mockResolvedValue({ logGlob: null, hosts: null });
    await expect(build().window(QUERY, asRequest(`Bearer ${TOKEN}`))).rejects.toThrow(UnprocessableEntityException);
  });

  it("measures the window once the token and the service check out", async () => {
    await build().window({ ...QUERY, pathPrefix: "/api" }, asRequest(`Bearer ${TOKEN}`));
    expect(window).toHaveBeenCalledWith(
      expect.objectContaining({ service: "atlas-front", pathPrefix: "/api", excludePathPrefix: null }),
    );
  });
});
