import { randomBytes, randomUUID } from "node:crypto";
import { PrismaService } from "@db/prisma.service";
import { MAX_SPANS_PER_REQUEST, OTLP_TOKEN_HEADER, OTLP_TRACES_PATH, SPAN_STATUS } from "@otlp/otlp-limits";
import { issueToken } from "@otlp/token";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, clearRateLimits, login } from "./helpers";

import type { INestApplication } from "@nestjs/common";

/**
 * `POST /api/otlp/v1/traces` and the two read routes behind it (IKN-87).
 *
 * Every token here is a row this suite creates with `issueToken`, exactly as `pnpm token:create`
 * would, under two service names nobody else uses. Teardown deletes the spans, the tokens and the
 * services by those names.
 */

const ORIGIN_A = "https://opifex.iknos.test";
const ORIGIN_B = "https://vidar.iknos.test";

let app: INestApplication;
let prisma: PrismaService;
let serviceA: string;
let serviceB: string;
let tokenA: string;
let tokenB: string;
const services: string[] = [];

const hex = (bytes: number) => randomBytes(bytes).toString("hex");
const nanos = (ms: number) => `${BigInt(ms) * 1_000_000n}`;

/** A root and a child, one second apart, started a minute ago. */
const twoSpans = (traceId: string) => {
  const root = hex(8);
  const start = Date.now() - 60_000;
  return [
    {
      traceId,
      spanId: root,
      name: "pipeline.run",
      kind: 1,
      startTimeUnixNano: nanos(start),
      endTimeUnixNano: nanos(start + 2_000),
      status: { code: SPAN_STATUS.ok },
    },
    {
      traceId,
      spanId: hex(8),
      parentSpanId: root,
      name: "llm.generate",
      kind: 3,
      startTimeUnixNano: nanos(start + 100),
      endTimeUnixNano: nanos(start + 1_100),
      attributes: [
        { key: "gen_ai.operation.name", value: { stringValue: "chat" } },
        { key: "gen_ai.request.model", value: { stringValue: "test-model" } },
        { key: "gen_ai.usage.input_tokens", value: { intValue: "40" } },
        { key: "gen_ai.usage.output_tokens", value: { intValue: "12" } },
      ],
    },
  ];
};

/** The payload claims to be `iknos-api` on purpose — the token must win. */
const body = (spans: unknown[]) => ({
  resourceSpans: [
    {
      resource: { attributes: [{ key: "service.name", value: { stringValue: "iknos-api" } }] },
      scopeSpans: [{ scope: { name: "officina" }, spans }],
    },
  ],
});

const post = (token: string) => request(app.getHttpServer()).post(OTLP_TRACES_PATH).set(OTLP_TOKEN_HEADER, token);

beforeAll(async () => {
  app = await buildTestApp();
  prisma = app.get(PrismaService);
  await clearRateLimits(app);

  serviceA = `t${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  serviceB = `t${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  services.push(serviceA, serviceB);
  for (const name of services) await prisma.service.create({ data: { name, pm2Name: name } });

  const a = issueToken();
  const b = issueToken();
  tokenA = a.clear;
  tokenB = b.clear;
  await prisma.ingestToken.create({
    data: { service: serviceA, tokenHash: a.hash, label: "e2e a", allowedOrigins: [ORIGIN_A] },
  });
  await prisma.ingestToken.create({
    data: { service: serviceB, tokenHash: b.hash, label: "e2e b", allowedOrigins: [ORIGIN_B] },
  });
});

afterAll(async () => {
  await prisma?.span.deleteMany({ where: { service: { in: services } } });
  await prisma?.ingestToken.deleteMany({ where: { service: { in: services } } });
  await prisma?.service.deleteMany({ where: { name: { in: services } } });
  await app?.close();
});

describe("POST /api/otlp/v1/traces", () => {
  describe("who may write", () => {
    it("stores the spans of a valid token under the token's service, whatever the payload claims", async () => {
      const traceId = hex(16);
      const res = await post(tokenA)
        .send(body(twoSpans(traceId)))
        .expect(200);

      expect(res.body).toEqual({ partialSuccess: {} });
      const rows = await prisma.span.findMany({ where: { traceId } });
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.service === serviceA)).toBe(true);

      const llm = rows.find((row) => row.name === "llm.generate");
      expect(llm?.genAiModel).toBe("test-model");
      expect(llm?.inputTokens).toBe(40);
      expect(llm?.durationUs).toBe(1_000_000n);
    });

    it("refuses a missing or wrong token with 401", async () => {
      await request(app.getHttpServer()).post(OTLP_TRACES_PATH).send(body([])).expect(401);
      await post(`${tokenA.slice(0, -2)}xx`)
        .send(body([]))
        .expect(401);
      await post("not-even-shaped-like-one").send(body([])).expect(401);
    });

    it("refuses a revoked token", async () => {
      const revoked = issueToken();
      await prisma.ingestToken.create({
        data: {
          service: serviceA,
          tokenHash: revoked.hash,
          label: "e2e revoked",
          allowedOrigins: [],
          revokedAt: new Date(),
        },
      });
      await post(revoked.clear).send(body([])).expect(401);
    });

    it("refuses a token whose service has been disabled", async () => {
      const off = `t${randomUUID().replace(/-/g, "").slice(0, 12)}`;
      services.push(off);
      await prisma.service.create({ data: { name: off, pm2Name: off, enabled: false } });
      const t = issueToken();
      await prisma.ingestToken.create({
        data: { service: off, tokenHash: t.hash, label: "e2e off", allowedOrigins: [] },
      });

      await post(t.clear)
        .send(body(twoSpans(hex(16))))
        .expect(401);
      expect(await prisma.span.count({ where: { service: off } })).toBe(0);
    });

    it("grants no read: a write token is not a session", async () => {
      await request(app.getHttpServer())
        .get(`/api/traces?service=${serviceA}&from=2026-01-01T00:00:00Z&to=2030-01-01T00:00:00Z`)
        .set(OTLP_TOKEN_HEADER, tokenA)
        .expect(401);
    });
  });

  describe("origin", () => {
    it("accepts the token's own origin and a caller with none", async () => {
      await post(tokenA).set("Origin", ORIGIN_A).send(body([])).expect(200);
      await post(tokenA).send(body([])).expect(200);
    });

    it("refuses another app's origin, even though some token allows it", async () => {
      await post(tokenA)
        .set("Origin", ORIGIN_B)
        .send(body(twoSpans(hex(16))))
        .expect(403);
      await post(tokenA).set("Origin", "https://evil.test").send(body([])).expect(403);
    });

    it("answers a preflight for any active token's origin, with Timing-Allow-Origin", async () => {
      const res = await request(app.getHttpServer())
        .options(OTLP_TRACES_PATH)
        .set("Origin", ORIGIN_B)
        .set("Access-Control-Request-Method", "POST")
        .set("Access-Control-Request-Headers", "content-type, x-iknos-token")
        .expect(204);

      expect(res.headers["access-control-allow-origin"]).toBe(ORIGIN_B);
      expect(res.headers["timing-allow-origin"]).toBe(ORIGIN_B);
      expect(res.headers["access-control-allow-methods"]).toBe("POST");
      expect(res.headers["access-control-allow-headers"]).toContain("X-Iknos-Token");
    });

    it("answers a preflight from an unknown origin without allowing it", async () => {
      const res = await request(app.getHttpServer())
        .options(OTLP_TRACES_PATH)
        .set("Origin", "https://evil.test")
        .set("Access-Control-Request-Method", "POST")
        .expect(204);

      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
      expect(res.headers["timing-allow-origin"]).toBeUndefined();
    });

    it("lets the page read the POST's answer, timings included", async () => {
      const res = await post(tokenA).set("Origin", ORIGIN_A).send(body([])).expect(200);
      expect(res.headers["access-control-allow-origin"]).toBe(ORIGIN_A);
      expect(res.headers["timing-allow-origin"]).toBe(ORIGIN_A);
    });
  });

  describe("the beacon path", () => {
    it("accepts text/plain with the token in the query string", async () => {
      const traceId = hex(16);
      const res = await request(app.getHttpServer())
        .post(`${OTLP_TRACES_PATH}?token=${encodeURIComponent(tokenB)}`)
        .set("Content-Type", "text/plain;charset=UTF-8")
        .set("Origin", ORIGIN_B)
        .send(JSON.stringify(body(twoSpans(traceId))))
        .expect(200);

      expect(res.body).toEqual({ partialSuccess: {} });
      expect(await prisma.span.count({ where: { traceId, service: serviceB } })).toBe(2);
    });

    it("refuses an encoding it does not speak", async () => {
      await post(tokenA)
        .set("Content-Type", "application/x-protobuf")
        .send(Buffer.from([1, 2, 3]))
        .expect(415);
    });
  });

  describe("what gets stored", () => {
    it("reports unusable spans as a partial success and keeps the rest", async () => {
      const traceId = hex(16);
      const [root] = twoSpans(traceId);
      const res = await post(tokenA)
        .send(body([root, { ...root, spanId: "nope" }]))
        .expect(200);

      expect(res.body.partialSuccess.rejectedSpans).toBe(1);
      expect(res.body.partialSuccess.errorMessage).toContain("spanId");
      expect(await prisma.span.count({ where: { traceId } })).toBe(1);
    });

    it("stores a resent batch once", async () => {
      const traceId = hex(16);
      const payload = body(twoSpans(traceId));
      await post(tokenA).send(payload).expect(200);
      await post(tokenA).send(payload).expect(200);

      expect(await prisma.span.count({ where: { traceId } })).toBe(2);
    });

    it("refuses a body that is not JSON, or not OTLP", async () => {
      await post(tokenA).set("Content-Type", "text/plain").send("{not json").expect(400);
      await post(tokenA).send({ resourceSpans: "nope" }).expect(400);
    });

    it("refuses more spans than one request may carry", async () => {
      const [root] = twoSpans(hex(16));
      const spans = Array.from({ length: MAX_SPANS_PER_REQUEST + 1 }, () => ({ ...root, spanId: hex(8) }));
      await post(tokenA).send(body(spans)).expect(400);
    });

    it("refuses a body past the byte ceiling with 413, before reading it", async () => {
      await post(tokenA)
        .set("Content-Type", "text/plain")
        .send(JSON.stringify({ padding: "x".repeat(1_200_000) }))
        .expect(413);
    });
  });
});

describe("the read routes", () => {
  let cookie: string;
  let traceId: string;

  beforeAll(async () => {
    cookie = await login(app);
    traceId = hex(16);
    await post(tokenA)
      .send(body(twoSpans(traceId)))
      .expect(200);
  });

  const window = () => {
    const to = new Date(Date.now() + 60_000).toISOString();
    const from = new Date(Date.now() - 3_600_000).toISOString();
    return `from=${from}&to=${to}`;
  };

  it("lists one row per trace, with its root, its tokens and its model", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/traces?service=${serviceA}&${window()}`)
      .set("Cookie", cookie)
      .expect(200);

    const row = res.body.traces.find((t: { traceId: string }) => t.traceId === traceId);
    expect(row).toMatchObject({
      service: serviceA,
      rootName: "pipeline.run",
      spanCount: 2,
      durationUs: 2_000_000,
      status: "ok",
      inputTokens: 40,
      outputTokens: 12,
      models: ["test-model"],
    });
  });

  it("returns one trace's spans in start order", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/traces/${traceId}?${window()}`)
      .set("Cookie", cookie)
      .expect(200);

    expect(res.body.spans.map((s: { name: string }) => s.name)).toEqual(["pipeline.run", "llm.generate"]);
    expect(res.body.spans[1].parentSpanId).toBe(res.body.spans[0].spanId);
  });

  it("requires a window and a service", async () => {
    await request(app.getHttpServer()).get(`/api/traces?service=${serviceA}`).set("Cookie", cookie).expect(400);
    await request(app.getHttpServer()).get(`/api/traces?${window()}`).set("Cookie", cookie).expect(400);
  });
});

describe("the per-token rate limit", () => {
  it("answers 429 with Retry-After once the token's budget is spent", async () => {
    process.env.IKNOS_OTLP_TOKEN_RATE_PER_MINUTE = "2";
    const limited = await buildTestApp();
    try {
      await clearRateLimits(limited);
      const send = () =>
        request(limited.getHttpServer()).post(OTLP_TRACES_PATH).set(OTLP_TOKEN_HEADER, tokenA).send(body([]));

      await send().expect(200);
      await send().expect(200);
      const res = await send().expect(429);
      expect(res.headers["retry-after"]).toBe("60");
    } finally {
      await limited.close();
      delete process.env.IKNOS_OTLP_TOKEN_RATE_PER_MINUTE;
    }
  });
});
