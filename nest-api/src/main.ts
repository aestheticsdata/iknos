// First, and on its own line: class-validator and class-transformer read their decorators back
// through the metadata reflection API, and the environment is validated before anything else.
import "reflect-metadata";

import { buildSessionMiddleware } from "@auth/session.middleware";
import { JSON_BODY_LIMIT } from "@config/body-limit";
import { parseEnv } from "@config/env.validation";
import { buildIngestCors } from "@ingest/ingest-cors";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { RedisService } from "@redis/redis.service";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";

import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Application } from "express";

async function bootstrap() {
  // bufferLogs holds Nest's startup lines until the pino logger is attached, so the first thing
  // written to stdout is already ECS rather than Nest's coloured console format.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // PM2 sends SIGTERM before SIGKILL. Without hooks a `pm2 reload` cuts requests in flight and
  // leaves the Prisma pool open.
  app.enableShutdownHooks();

  // Already validated by ConfigModule at module load; parsed again here only to get the typed
  // value rather than a string off process.env.
  const { port, cookieSecret, ingestOrigins } = parseEnv({ ...process.env });

  // Behind nginx. Without this, req.ip is the proxy — so the login rate limit counts the whole
  // internet as one client — and a Secure cookie is never set.
  (app.getHttpAdapter().getInstance() as Application).set("trust proxy", 1);

  // whitelist strips properties no DTO declares, so a request cannot smuggle a field a handler
  // was never written to expect.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

  // Ahead of the session middleware: a preflight OPTIONS carries no cookie and must not touch
  // Redis, and the cross-origin POST it clears runs with `credentials: "omit"` anyway.
  app.use(buildIngestCors(ingestOrigins));

  // Registered before listen and therefore ahead of every route, including /health, which
  // stores nothing and so still costs no Redis entry.
  app.use(
    buildSessionMiddleware(app.get(RedisService).getClient(), cookieSecret, process.env.NODE_ENV === "production"),
  );

  // Registered before `listen`, which is what runs `init` and its default parsers: Nest applies
  // its own JSON parser only when none is on the stack yet, so putting one here is how the 100 kB
  // default is replaced rather than merely shadowed by a second, later one.
  app.useBodyParser("json", { limit: JSON_BODY_LIMIT });

  // Loopback only, never 0.0.0.0 — nginx is the sole thing that should reach this port, and
  // Node with no bind host listens on every interface.
  await app.listen(port, "127.0.0.1");
}

void bootstrap();
