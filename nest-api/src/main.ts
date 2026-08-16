// First, and on its own line: class-validator and class-transformer read their decorators back
// through the metadata reflection API, and the environment is validated before anything else.
import "reflect-metadata";

import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { buildSessionMiddleware } from "./auth/session.middleware";
import { parseEnv } from "./config/env.validation";
import { RedisService } from "./redis/redis.service";

import type { Application } from "express";

async function bootstrap() {
  // bufferLogs holds Nest's startup lines until the pino logger is attached, so the first thing
  // written to stdout is already ECS rather than Nest's coloured console format.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // PM2 sends SIGTERM before SIGKILL. Without hooks a `pm2 reload` cuts requests in flight and
  // leaves the Prisma pool open.
  app.enableShutdownHooks();

  // Already validated by ConfigModule at module load; parsed again here only to get the typed
  // value rather than a string off process.env.
  const { port, cookieSecret } = parseEnv({ ...process.env });

  // Behind nginx. Without this, req.ip is the proxy — so the login rate limit counts the whole
  // internet as one client — and a Secure cookie is never set.
  (app.getHttpAdapter().getInstance() as Application).set("trust proxy", 1);

  // whitelist strips properties no DTO declares, so a request cannot smuggle a field a handler
  // was never written to expect.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

  // Registered before listen and therefore ahead of every route, including /health, which
  // stores nothing and so still costs no Redis entry.
  app.use(
    buildSessionMiddleware(app.get(RedisService).getClient(), cookieSecret, process.env.NODE_ENV === "production"),
  );

  // Loopback only, never 0.0.0.0 — nginx is the sole thing that should reach this port, and
  // Node with no bind host listens on every interface.
  await app.listen(port, "127.0.0.1");
}

void bootstrap();
