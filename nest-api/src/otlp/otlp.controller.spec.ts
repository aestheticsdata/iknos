import { randomBytes } from "node:crypto";
import { RateLimitService } from "@auth/ratelimit.service";
import { AllExceptionsFilter } from "@common/all-exceptions.filter";
import { JSON_BODY_LIMIT } from "@config/body-limit";
import { ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OtlpController } from "./otlp.controller";
import { buildOtlpCors, OTLP_BODY_PARSER } from "./otlp-http";
import { OTLP_TOKEN_HEADER, OTLP_TRACES_PATH } from "./otlp-limits";
import { SpanWriter } from "./span-writer.service";
import { TokenRegistry } from "./token-registry.service";

import type { NestExpressApplication } from "@nestjs/platform-express";
import type { OriginCheck, SpanRecord, TokenGrant } from "./interfaces/otlp-types";

/**
 * The HTTP layer of `POST /api/otlp/v1/traces` (IKN-87) with the database and Redis replaced —
 * the body reader, CORS, the status codes and the response shape, mounted in the order `main.ts`
 * mounts them. `test/otlp-traces.e2e-spec.ts` covers the same route against MySQL and Redis.
 */

const TOKEN = `ikt_${"a".repeat(43)}`;
const ORIGIN = "https://opifex.iknos.test";
const OTHER_ORIGIN = "https://vidar.iknos.test";
const GRANT: TokenGrant = { id: 1, service: "opifex-front", origins: [ORIGIN] };

const written: SpanRecord[][] = [];
let allow = true;

const registry: OriginCheck & Pick<TokenRegistry, "resolve" | "touch"> = {
  resolve: async (clear: string) => (clear === TOKEN ? GRANT : null),
  isKnownOrigin: async (origin: string) => origin === ORIGIN || origin === OTHER_ORIGIN,
  touch: () => undefined,
};

let app: NestExpressApplication;

const nanos = (ms: number) => `${BigInt(ms) * 1_000_000n}`;
const span = () => {
  const start = Date.now() - 1_000;
  return {
    traceId: randomBytes(16).toString("hex"),
    spanId: randomBytes(8).toString("hex"),
    name: "pipeline.run",
    startTimeUnixNano: nanos(start),
    endTimeUnixNano: nanos(start + 500),
  };
};
const body = (spans: unknown[]) => ({ resourceSpans: [{ scopeSpans: [{ spans }] }] });
const post = () => request(app.getHttpServer()).post(OTLP_TRACES_PATH);

beforeAll(async () => {
  // What `parseEnv` needs to construct the controller. Nothing here connects to anything.
  process.env.DATABASE_URL ??= "mysql://unused:unused@127.0.0.1:1/unused";
  process.env.REDIS_URL ??= "redis://127.0.0.1:1";
  process.env.IKNOS_PORT ??= "4310";
  process.env.IKNOS_LOG_LEVEL ??= "error";
  process.env.IKNOS_COOKIE_SECRET ??= "x".repeat(64);
  process.env.IKNOS_RETENTION_DAYS ??= "14";
  process.env.IKNOS_PM2_LOG_GLOB ??= "/nonexistent/*.log";

  const moduleRef = await Test.createTestingModule({
    controllers: [OtlpController],
    providers: [
      { provide: TokenRegistry, useValue: registry },
      {
        provide: SpanWriter,
        useValue: {
          write: async (spans: SpanRecord[]) => {
            written.push(spans);
            return spans.length;
          },
        },
      },
      {
        provide: RateLimitService,
        useValue: { allowOtlpIp: async () => allow, allowOtlpToken: async () => true },
      },
    ],
  }).compile();

  app = moduleRef.createNestApplication<NestExpressApplication>();
  app.use(buildOtlpCors(registry));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  // The production filter, which maps the body reader's 413 the way the API answers it.
  app.useGlobalFilters(new AllExceptionsFilter({ error: () => undefined }));
  app.useBodyParser("text", OTLP_BODY_PARSER);
  app.useBodyParser("json", { limit: JSON_BODY_LIMIT });
  await app.init();
});

beforeEach(() => {
  written.length = 0;
  allow = true;
});

afterAll(async () => {
  await app?.close();
});

describe("POST /api/otlp/v1/traces, HTTP layer", () => {
  it("accepts OTLP JSON with the header token and answers an empty partial success", async () => {
    const res = await post()
      .set(OTLP_TOKEN_HEADER, TOKEN)
      .send(body([span()]))
      .expect(200);

    expect(res.body).toEqual({ partialSuccess: {} });
    expect(written[0]).toHaveLength(1);
    expect(written[0][0].service).toBe("opifex-front");
  });

  it("accepts the beacon: text/plain, token in the query", async () => {
    await post()
      .query({ token: TOKEN })
      .set("Content-Type", "text/plain;charset=UTF-8")
      .send(JSON.stringify(body([span(), span()])))
      .expect(200);

    expect(written[0]).toHaveLength(2);
  });

  it("counts rejected spans in the partial success", async () => {
    const res = await post()
      .set(OTLP_TOKEN_HEADER, TOKEN)
      .send(body([span(), { ...span(), traceId: "short" }]))
      .expect(200);

    expect(res.body.partialSuccess).toEqual({
      rejectedSpans: 1,
      errorMessage: "traceId must be 32 hex characters, not all zero",
    });
  });

  it("answers 401 without a valid token", async () => {
    await post().send(body([])).expect(401);
    await post().set(OTLP_TOKEN_HEADER, "ikt_wrongwrongwrongwrongwrong").send(body([])).expect(401);
  });

  it("answers 403 to an origin the token does not list, even one another token allows", async () => {
    const res = await post().set(OTLP_TOKEN_HEADER, TOKEN).set("Origin", OTHER_ORIGIN).send(body([])).expect(403);
    // Still readable by that page: the allow header is on the refusal too.
    expect(res.headers["access-control-allow-origin"]).toBe(OTHER_ORIGIN);
    expect(written).toHaveLength(0);
  });

  it("answers 415 to an encoding other than JSON", async () => {
    await post()
      .set(OTLP_TOKEN_HEADER, TOKEN)
      .set("Content-Type", "application/x-protobuf")
      .send(Buffer.from([1, 2]))
      .expect(415);
  });

  it("answers 400 to a body that is not JSON or not OTLP", async () => {
    await post().set(OTLP_TOKEN_HEADER, TOKEN).set("Content-Type", "text/plain").send("{nope").expect(400);
    await post().set(OTLP_TOKEN_HEADER, TOKEN).send({ resourceSpans: 1 }).expect(400);
    await post().set(OTLP_TOKEN_HEADER, TOKEN).set("Content-Type", "text/plain").send("").expect(400);
  });

  it("answers 413 past the byte ceiling", async () => {
    await post()
      .set(OTLP_TOKEN_HEADER, TOKEN)
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ padding: "x".repeat(1_100_000) }))
      .expect(413);
  });

  it("answers 429 with Retry-After when the address is over its budget", async () => {
    allow = false;
    const res = await post().set(OTLP_TOKEN_HEADER, TOKEN).send(body([])).expect(429);
    expect(res.headers["retry-after"]).toBe("60");
  });

  it("answers the preflight for a known origin with CORS and Timing-Allow-Origin", async () => {
    const res = await request(app.getHttpServer())
      .options(OTLP_TRACES_PATH)
      .set("Origin", ORIGIN)
      .set("Access-Control-Request-Method", "POST")
      .expect(204);

    expect(res.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(res.headers["timing-allow-origin"]).toBe(ORIGIN);
    expect(res.headers["access-control-allow-headers"]).toBe("Content-Type, X-Iknos-Token");
    expect(res.headers.vary).toContain("Origin");
  });

  it("sends Timing-Allow-Origin on the POST too, so the page can measure what it sent", async () => {
    const res = await post().set(OTLP_TOKEN_HEADER, TOKEN).set("Origin", ORIGIN).send(body([])).expect(200);
    expect(res.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(res.headers["timing-allow-origin"]).toBe(ORIGIN);
  });

  it("allows nothing to an unknown origin", async () => {
    const res = await request(app.getHttpServer())
      .options(OTLP_TRACES_PATH)
      .set("Origin", "https://evil.test")
      .set("Access-Control-Request-Method", "POST")
      .expect(204);

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["timing-allow-origin"]).toBeUndefined();
  });
});
