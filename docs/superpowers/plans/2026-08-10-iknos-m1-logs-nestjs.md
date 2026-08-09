# Iknos M1 — Logs End to End (NestJS): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a deployed Iknos that tails every PM2 log file on ks-b into MySQL and serves it back through an authenticated Logs page with search, filters and live tail.

**Architecture:** One NestJS app (`iknos-api`) hosts the collector and the HTTP API in a single process, talking to MySQL through Prisma and Redis for sessions. A Next app holds no database access — its server components fetch the API over localhost, forwarding the session cookie. nginx routes `/api/*` to Nest and everything else to Next on one subdomain.

**Tech Stack:** NestJS, Prisma 7 + `@prisma/adapter-mariadb`, MySQL 8 with daily partitioning, Redis, pino + `@elastic/ecs-pino-format`, Next App Router, Tailwind v4, PM2, nginx.

**Spec:** `docs/superpowers/specs/2026-08-10-iknos-nestjs-api-design.md`

## Global Constraints

- `biome check` and `vitest run` must pass before every commit. Biome config copied from PFA, `lineWidth: 120`.
- Path aliases everywhere, never relative imports across directories.
- `ingest` and `logs` modules may both depend on `packages/db` and on the event bus, **never on each other**.
- Migrations are applied by hand over SSH. **No task ever runs a migration from a deploy script.**
- DB column names: `byte_offset` not `offset` (`OFFSET` is reserved in MySQL 8.0); the users table is `app_user` not `user`.
- Every route except `GET /health` and `POST /api/auth/login` requires a valid session, enforced by a global `APP_GUARD`, never per-controller.
- Error responses never contain internal detail (SQL text, file paths, hostnames). Detail goes to logs only.
- `GET /api/logs` and `GET /api/logs/stream` reject any request without both `from` and `to`.
- Nothing in the ingestion path may block the event loop: no sync file I/O, no `JSON.parse` on an unbounded line, no backtracking regex over log text.
- Commits use the repo's configured git identity, with no co-author or tool attribution trailers.

## File Structure

```
iknos/
  pnpm-workspace.yaml
  prisma/schema.prisma
  packages/
    db/                            Prisma client singleton + shared types
    contracts/                     response DTOs imported by both apps
  apps/
    api/src/
      main.ts                      bootstrap, shutdown hooks
      app.module.ts
      config/env.ts                schema + validated Config type
      common/
        all-exceptions.filter.ts
        logger.ts                  pino ECS + INGEST_SKIP_MARKER
      auth/
        session.service.ts         Redis session store
        csrf.util.ts               constant-time compare
        session.guard.ts           APP_GUARD + @Public()
        auth.controller.ts         login, logout, csrf, me
        ratelimit.service.ts
      logs/
        logs.controller.ts
        logs.service.ts            raw SQL query builder
        cursor.ts                  encode/decode keyset cursor
      stream/
        log-bus.ts                 in-process event bus
        stream.controller.ts       manual SSE
      ingest/
        line-buffer.ts             byte framing
        parser.ts                  ECS / bare JSON / plain text
        tailer.ts                  stat loop, rotation
        writer.ts                  bounded queue, transactional batch
        ingest.service.ts          lifecycle wiring
      maintenance/
        partitions.ts              pure planning
        maintenance.service.ts     scheduled job
  apps/web/                        Next App Router
  deploy/                          ecosystem, nginx, deploy.sh
```

---

## Task 1: Workspace skeleton

**Files:**
- Create: `pnpm-workspace.yaml`, `package.json`, `biome.json`, `vitest.config.ts`, `packages/db/`, `packages/contracts/`, `apps/api/`, `apps/web/` (placeholder)

**Interfaces:**
- Produces: a workspace where `pnpm -r build` succeeds, giving every later task a package to write into.

- [ ] **Step 1: Create the workspace**

`pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

Scaffold the Nest app with `pnpm dlx @nestjs/cli new api --skip-git --package-manager pnpm` inside `apps/`, then delete the generated `app.controller.*` and `app.service.*` — they are template noise.

- [ ] **Step 2: Copy the tooling config from PFA**

`biome.json` (same rules, `lineWidth: 120`) and a root `vitest.config.ts` with workspace projects. Add path aliases in each `tsconfig.json` so nothing imports across directories relatively.

- [ ] **Step 3: Verify**

Run: `pnpm install && pnpm -r build && pnpm biome check && pnpm vitest run`
Expected: all four succeed. Vitest reports no test files, which is a pass at this stage.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "chore: pnpm workspace skeleton"
```

---

## Task 2: Confirm MySQL on ks-b supports the schema

**Files:**
- Create: `docs/ks-b-mysql.md`

**Interfaces:**
- Produces: a recorded MySQL version and proof that native InnoDB partitioning works. Task 3 must not be written before this passes.

This is the spec's open item #1. It is a task rather than a footnote because the entire storage design rests on the answer.

- [ ] **Step 1: Check the version**

Run over SSH on ks-b:

```bash
mysql -e "SELECT VERSION()"
```

Expected: MySQL 8.0 or later. In 8.0 partitioning is built into InnoDB and is not listed as a plugin, so an empty `SHOW PLUGINS` grep for "partition" is the correct result there, not a failure.

- [ ] **Step 2: Prove it with a throwaway table**

Run over SSH:

```bash
mysql iknos -e "CREATE TABLE _pt (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, ts DATETIME(3) NOT NULL, PRIMARY KEY (id, ts)) ENGINE=InnoDB PARTITION BY RANGE (TO_DAYS(ts)) (PARTITION p_future VALUES LESS THAN MAXVALUE); SHOW CREATE TABLE _pt\G DROP TABLE _pt;"
```

Expected: the output ends with a `/*!50100 PARTITION BY RANGE ... */` clause. If this errors, stop and report — the schema design needs revisiting before any code is written.

Note what this also proves: an `AUTO_INCREMENT` column works as the leading part of a composite primary key, which is exactly what `LogEntry` needs.

- [ ] **Step 3: Record it**

`docs/ks-b-mysql.md`:

```markdown
# MySQL on ks-b

- Version: <paste output of SELECT VERSION()>
- Native InnoDB partitioning: confirmed <date> by creating and dropping a
  RANGE-partitioned table with a composite PK in the `iknos` database.
- Consequence: LogEntry is partitioned by day and carries no FULLTEXT index.
  See docs/superpowers/specs/2026-08-10-iknos-nestjs-api-design.md §4.2.
```

- [ ] **Step 4: Commit**

```bash
git add docs/ks-b-mysql.md
git commit -m "docs: confirm MySQL version and partitioning support on ks-b"
```

---

## Task 3: Prisma schema and the partitioned migration

**Files:**
- Create: `prisma/schema.prisma`, `packages/db/src/index.ts`, `packages/db/src/seed.ts`, `.env.example`
- Modify: the generated migration SQL, by hand

**Interfaces:**
- Produces: `packages/db` exporting a single `prisma` client, and the four M1 tables. Every later task reads or writes through it.

- [ ] **Step 1: Write the schema**

`prisma/schema.prisma` — `provider = "mysql"`, driver adapter `@prisma/adapter-mariadb`, same pairing as PFA.

```prisma
model Service {
  id         Int      @id @default(autoincrement())
  name       String   @unique @db.VarChar(64)
  pm2Name    String   @map("pm2_name") @db.VarChar(64)
  metricsUrl String?  @map("metrics_url") @db.VarChar(255)
  healthUrl  String?  @map("health_url") @db.VarChar(255)
  logGlob    String?  @map("log_glob") @db.VarChar(512)
  enabled    Boolean  @default(true)
  createdAt  DateTime @default(now()) @map("created_at") @db.DateTime(3)

  @@map("service")
}

model AppUser {
  id           Int      @id @default(autoincrement())
  email        String   @unique @db.VarChar(255)
  passwordHash String   @map("password_hash") @db.VarChar(255)
  createdAt    DateTime @default(now()) @map("created_at") @db.DateTime(3)

  @@map("app_user")
}

model IngestOffset {
  filePath   String   @id @map("file_path") @db.VarChar(512)
  dev        BigInt   @db.UnsignedBigInt
  inode      BigInt   @db.UnsignedBigInt
  byteOffset BigInt   @map("byte_offset") @db.UnsignedBigInt
  updatedAt  DateTime @updatedAt @map("updated_at") @db.DateTime(3)

  @@map("ingest_offset")
}

model LogEntry {
  id         BigInt   @default(autoincrement()) @db.UnsignedBigInt
  ts         DateTime @db.DateTime(3)
  service    String   @db.VarChar(64)
  level      Int      @db.SmallInt
  levelName  String   @map("level_name") @db.VarChar(16)
  logger     String?  @db.VarChar(128)
  message    String   @db.Text
  traceId    String?  @map("trace_id") @db.Char(32)
  httpMethod String?  @map("http_method") @db.VarChar(10)
  route      String?  @db.VarChar(255)
  statusCode Int?     @map("status_code") @db.SmallInt
  durationMs Int?     @map("duration_ms")
  clientIp   String?  @map("client_ip") @db.VarChar(45)
  userId     String?  @map("user_id") @db.VarChar(64)
  hostname   String?  @db.VarChar(128)
  attrs      Json?

  @@id([id, ts])
  @@index([service, ts])
  @@index([level, ts])
  @@index([traceId, ts])
  @@index([route, ts])
  @@map("log_entry")
}
```

The composite `@@id([id, ts])` is required: MySQL demands every unique key of a partitioned table contain the partitioning column. Keeping `id` first satisfies InnoDB's separate rule about `AUTO_INCREMENT`.

- [ ] **Step 2: Generate the migration without applying it**

Run:

```bash
pnpm prisma migrate dev --create-only --name init
```

Expected: a migration directory containing `migration.sql`, not yet applied.

- [ ] **Step 3: Hand-edit the migration to add partitioning**

Prisma cannot express partitioning, so append the clause to the `CREATE TABLE log_entry` statement in `migration.sql`:

```sql
) ENGINE=InnoDB
PARTITION BY RANGE (TO_DAYS(ts)) (
  PARTITION p_future VALUES LESS THAN MAXVALUE
);
```

Only `p_future` is created here. The table is correct and writable from the first insert; the sliding window is Task 18's job.

- [ ] **Step 4: Apply and verify the partitioning survived**

Run:

```bash
pnpm prisma migrate dev && mysql iknos -e "SHOW CREATE TABLE log_entry\G"
```

Expected: the output contains `PARTITION BY RANGE (TO_DAYS(ts))`. If the clause is absent, Prisma regenerated the file and dropped the edit — re-apply it and use `migrate resolve` rather than letting `migrate dev` rewrite it.

- [ ] **Step 5: Check Prisma does not consider the table drifted**

Run:

```bash
pnpm prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code
```

Expected: exit code 0, no drift. Partitioning is a table attribute Prisma does not model, so it should be invisible to the diff. **If it does report drift, stop and solve it here** — a schema that Prisma wants to "fix" on every migration will silently drop the partitioning the first time someone runs `migrate dev` in a hurry.

- [ ] **Step 6: Export the client and seed the registry**

`packages/db/src/index.ts` exports one `PrismaClient` instance built on the mariadb adapter — a single instance shared by both apps, never one per module.

`packages/db/src/seed.ts` inserts `pfa-api` / `pfa-nest-api` and `pfa-front` / `pfa-front` into `service`.

Write `.env.example` with `DATABASE_URL`, `REDIS_URL`, `IKNOS_PORT`, `IKNOS_LOG_LEVEL`, `IKNOS_COOKIE_SECRET`, `IKNOS_RETENTION_DAYS`, `IKNOS_PM2_LOG_GLOB`.

- [ ] **Step 7: Commit**

```bash
git add prisma/ packages/db .env.example
git commit -m "feat(db): prisma schema with day-partitioned log_entry"
```

---

## Task 4: Validated configuration

**Files:**
- Create: `apps/api/src/config/env.ts`, `apps/api/src/config/env.spec.ts`

**Interfaces:**
- Produces: `parseEnv(source: Record<string, string | undefined>): Config` throwing a named error, and the `Config` type with `databaseUrl`, `redisUrl`, `port`, `logLevel`, `cookieSecret`, `retentionDays`, `pm2LogGlob`. Registered in `ConfigModule` so every service injects the typed object, never `process.env`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/config/env.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const full = {
  DATABASE_URL: "mysql://x/y",
  REDIS_URL: "redis://x",
  IKNOS_PORT: "4310",
  IKNOS_LOG_LEVEL: "info",
  IKNOS_COOKIE_SECRET: "k".repeat(64),
  IKNOS_RETENTION_DAYS: "14",
  IKNOS_PM2_LOG_GLOB: "/tmp/*.log",
};

describe("parseEnv", () => {
  it("loads a complete environment", () => {
    const cfg = parseEnv(full);
    expect(cfg.port).toBe(4310);
    expect(cfg.retentionDays).toBe(14);
  });

  it("names the missing variable", () => {
    const { REDIS_URL, ...rest } = full;
    expect(() => parseEnv(rest)).toThrow(/REDIS_URL/);
  });

  it("rejects a short cookie secret", () => {
    expect(() => parseEnv({ ...full, IKNOS_COOKIE_SECRET: "short" })).toThrow(
      /IKNOS_COOKIE_SECRET/,
    );
  });

  it("rejects a non-numeric port", () => {
    expect(() => parseEnv({ ...full, IKNOS_PORT: "http" })).toThrow(/IKNOS_PORT/);
  });

  it("rejects a zero retention window", () => {
    expect(() => parseEnv({ ...full, IKNOS_RETENTION_DAYS: "0" })).toThrow(
      /IKNOS_RETENTION_DAYS/,
    );
  });
});
```

Taking a source object rather than reading `process.env` keeps the tests free of global state and therefore order-independent.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/api/src/config`
Expected: FAIL — cannot resolve `./env`.

- [ ] **Step 3: Implement it**

`apps/api/src/config/env.ts`:

```ts
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  IKNOS_PORT: z.coerce.number().int().min(1).max(65535),
  IKNOS_LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]),
  // Long enough to sign cookies with real entropy.
  IKNOS_COOKIE_SECRET: z.string().min(64),
  IKNOS_RETENTION_DAYS: z.coerce.number().int().min(1),
  IKNOS_PM2_LOG_GLOB: z.string().min(1),
});

export type Config = {
  databaseUrl: string;
  redisUrl: string;
  port: number;
  logLevel: string;
  cookieSecret: string;
  retentionDays: number;
  pm2LogGlob: string;
};

export function parseEnv(source: Record<string, string | undefined>): Config {
  const result = schema.safeParse(source);

  if (!result.success) {
    // Name every offending variable, so a bad deploy fails at boot with a
    // message that says what to fix rather than throwing three hours later.
    const details = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`invalid environment: ${details}`);
  }

  const e = result.data;
  return {
    databaseUrl: e.DATABASE_URL,
    redisUrl: e.REDIS_URL,
    port: e.IKNOS_PORT,
    logLevel: e.IKNOS_LOG_LEVEL,
    cookieSecret: e.IKNOS_COOKIE_SECRET,
    retentionDays: e.IKNOS_RETENTION_DAYS,
    pm2LogGlob: e.IKNOS_PM2_LOG_GLOB,
  };
}
```

Wire it into `ConfigModule.forRoot({ validate: parseEnv, isGlobal: true })`. If PFA already standardises on Joi or class-validator, use that instead — the tests above hold either way.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/api/src/config`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/config
git commit -m "feat(api): validated environment configuration"
```

---

## Task 5: Exception filter

**Files:**
- Create: `apps/api/src/common/all-exceptions.filter.ts`, `apps/api/src/common/all-exceptions.filter.spec.ts`

**Interfaces:**
- Produces: `AllExceptionsFilter`, registered as `APP_FILTER`. Every controller can throw freely from here on.

- [ ] **Step 1: Write the failing test**

`apps/api/src/common/all-exceptions.filter.spec.ts`:

```ts
import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AllExceptionsFilter } from "./all-exceptions.filter";

function mockHost() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return {
    host: {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ url: "/api/logs", method: "GET" }),
      }),
    },
    status,
    json,
  };
}

describe("AllExceptionsFilter", () => {
  it("never leaks internal detail from an unknown error", () => {
    const { host, status, json } = mockHost();
    const logger = { error: vi.fn() };

    new AllExceptionsFilter(logger as never).catch(
      new Error("Table 'iknos.secret' doesn't exist"),
      host as never,
    );

    expect(status).toHaveBeenCalledWith(500);
    const body = JSON.stringify(json.mock.calls[0][0]);
    expect(body).not.toContain("secret");
    expect(body).toContain("internal error");
    // The detail must still reach the logs, or the outage is undebuggable.
    expect(logger.error).toHaveBeenCalled();
  });

  it("keeps the message of a deliberate client error", () => {
    const { host, status, json } = mockHost();

    new AllExceptionsFilter({ error: vi.fn() } as never).catch(
      new BadRequestException("both 'from' and 'to' are required"),
      host as never,
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(JSON.stringify(json.mock.calls[0][0])).toContain("from");
  });
});
```

The first test is the spec's "errors never leak internal detail" constraint made executable. It fails loudly the day someone adds the exception message to the response body while debugging.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/api/src/common`
Expected: FAIL — cannot resolve `./all-exceptions.filter`.

- [ ] **Step 3: Implement it**

`apps/api/src/common/all-exceptions.filter.ts`:

```ts
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from "@nestjs/common";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: { error: (obj: unknown, msg?: string) => void }) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const res = http.getResponse();
    const req = http.getRequest();

    if (exception instanceof HttpException) {
      // Deliberate client errors carry a message we chose, so it is safe to send.
      const status = exception.getStatus();
      const payload = exception.getResponse();
      res.status(status).json(
        typeof payload === "string" ? { error: payload } : payload,
      );
      return;
    }

    // Anything else is unplanned. The client learns nothing; the logs learn all.
    this.logger.error(
      { err: exception, url: req?.url, method: req?.method },
      "unhandled exception",
    );
    res.status(500).json({ error: "internal error" });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/api/src/common`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common
git commit -m "feat(api): global exception filter that never leaks detail"
```

---

## Task 6: ECS logging and the self-error marker

**Files:**
- Create: `apps/api/src/common/logger.ts`, `apps/api/src/common/logger.spec.ts`

**Interfaces:**
- Produces: `logger` (a pino instance emitting ECS), and `INGEST_SKIP_MARKER = "IKNOS_SELF_ERR"`. Task 12's parser must skip lines containing the marker; Task 15's writer prints it on database failure.

- [ ] **Step 1: Write the failing test**

`apps/api/src/common/logger.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildLogger, INGEST_SKIP_MARKER } from "./logger";

function capture(fn: (write: (chunk: string) => void) => void): string[] {
  const lines: string[] = [];
  fn((chunk) => lines.push(chunk));
  return lines;
}

describe("logger", () => {
  it("emits ECS-shaped NDJSON", () => {
    const lines = capture((write) => {
      const log = buildLogger("info", { write });
      log.info("resumed at offset 4096");
    });

    const parsed = JSON.parse(lines[0]);
    expect(parsed["@timestamp"]).toBeTruthy();
    expect(parsed["log.level"]).toBe("info");
    expect(parsed.message).toBe("resumed at offset 4096");
    expect(parsed["service.name"]).toBe("iknos");
    expect(parsed["ecs.version"]).toBeTruthy();
  });

  it("keeps one event on one line even with newlines in the message", () => {
    const lines = capture((write) => {
      const log = buildLogger("info", { write });
      log.info("a\nb\tc");
    });

    // Trailing newline aside, an event must never span two records: it would
    // be re-ingested as several rows, one of which is invalid JSON.
    expect(lines[0].trimEnd().split("\n")).toHaveLength(1);
    expect(JSON.parse(lines[0]).message).toBe("a\nb\tc");
  });

  it("exports a marker the ingest parser can recognise", () => {
    expect(INGEST_SKIP_MARKER).toBe("IKNOS_SELF_ERR");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/api/src/common/logger`
Expected: FAIL — cannot resolve `./logger`.

- [ ] **Step 3: Implement it**

Install `pino`, `@elastic/ecs-pino-format` and `nestjs-pino`.

`apps/api/src/common/logger.ts`:

```ts
import ecsFormat from "@elastic/ecs-pino-format";
import pino, { type DestinationStream } from "pino";

/**
 * Printed on stderr when the database write path itself fails. The ingest
 * parser skips any line containing it, so a database outage cannot become an
 * infinite loop of failures logging failures.
 */
export const INGEST_SKIP_MARKER = "IKNOS_SELF_ERR";

export function buildLogger(level: string, dest?: DestinationStream) {
  // Same emitter IKN-1 puts in PFA, so Iknos monitors itself through its own
  // pipeline with no special casing.
  return pino({ level, ...ecsFormat({ serviceName: "iknos" }) }, dest);
}

export const logger = buildLogger(process.env.IKNOS_LOG_LEVEL ?? "info");
```

Register it with `LoggerModule.forRoot({ pinoHttp: { logger } })` from `nestjs-pino` and `app.useLogger(app.get(Logger))`, so Nest's own output takes the same shape.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/api/src/common`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common
git commit -m "feat(api): ECS-shaped logging and the self-error marker"
```

---

## Task 7: Bootstrap, /health, shutdown and BigInt serialization

**Files:**
- Create: `apps/api/src/health.controller.ts`, `apps/api/test/health.e2e-spec.ts`
- Modify: `apps/api/src/main.ts`, `apps/api/src/app.module.ts`

**Interfaces:**
- Produces: a running server on `127.0.0.1:<port>` serving `GET /health`. Tasks 10, 16, 17 add controllers to the same app.

- [ ] **Step 1: Write the failing test**

`apps/api/test/health.e2e-spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";

describe("health", () => {
  let app: import("@nestjs/common").INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  it("is public and reveals nothing", async () => {
    const res = await request(app.getHttpServer()).get("/health").expect(200);

    expect(res.body).toEqual({ status: "ok" });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("version");
    expect(body).not.toContain("hostname");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/api/test/health`
Expected: FAIL — 404, no such route.

- [ ] **Step 3: Implement the controller**

`apps/api/src/health.controller.ts`:

```ts
import { Controller, Get } from "@nestjs/common";
import { Public } from "./auth/public.decorator"; // added in Task 9

@Controller()
export class HealthController {
  /** Liveness only. No version, no dependency status, no hostname. */
  @Public()
  @Get("health")
  health() {
    return { status: "ok" };
  }
}
```

Until Task 9 exists, omit the `@Public()` line and add it there.

- [ ] **Step 4: Write the bootstrap**

`apps/api/src/main.ts`:

```ts
import { Logger } from "nestjs-pino";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // PM2 sends SIGTERM before SIGKILL. Without hooks a `pm2 reload` cuts
  // requests in flight and leaves the Prisma pool open.
  app.enableShutdownHooks();

  const port = Number(process.env.IKNOS_PORT);
  // Loopback only — nginx is the sole thing that should reach this port.
  await app.listen(port, "127.0.0.1");
}

void bootstrap();
```

- [ ] **Step 5: Handle BigInt before it bites**

`LogEntry.id` is a `BigInt`, and `JSON.stringify` throws `TypeError: Do not know how to serialize a BigInt` the first time a log row reaches a response. Fix it at the DTO boundary — Task 16 maps `id` to a string explicitly.

Do **not** patch `BigInt.prototype.toJSON` globally. It looks like a one-line fix, but it silently turns every BigInt anywhere into a string, including in places where you would rather have had the error.

Add a test that locks the decision in, in `apps/api/test/health.e2e-spec.ts`:

```ts
it("BigInt is not globally patched", () => {
  expect(() => JSON.stringify({ n: 1n })).toThrow(TypeError);
});
```

- [ ] **Step 6: Run the tests and check it starts**

Run: `pnpm vitest run apps/api/test`
Expected: PASS, 2 tests.

Then:

```bash
pnpm --filter api start &
sleep 3 && curl -s localhost:4310/health && ss -tlnp | grep 4310 && kill -TERM %1
```

Expected: `{"status":"ok"}`; `ss` shows `127.0.0.1:4310` and **not** `0.0.0.0:4310`; the process exits cleanly. The first log line is ECS JSON containing `"log.level":"info"`.

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): bootstrap, health check and graceful shutdown"
```

---

## Task 8: Redis session store

**Files:**
- Create: `apps/api/src/auth/session.service.ts`, `apps/api/src/auth/session.service.spec.ts`

**Interfaces:**
- Produces: `SessionService` with `create(userId: number): Promise<{ sid: string; session: Session }>`, `get(sid: string): Promise<Session | null>` (slides the TTL), `destroy(sid: string)`, `destroyForUser(userId: number)`, and `Session = { userId: number; csrfToken: string }`. Tasks 9 and 10 consume all of it.

Start from PFA's session service and adapt: same key shape, same one-session-per-user rule, TTL raised to 2h.

- [ ] **Step 1: Write the failing test**

`apps/api/src/auth/session.service.spec.ts`:

```ts
import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SessionService } from "./session.service";

let redis: Redis;
let sessions: SessionService;

beforeAll(() => {
  redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  sessions = new SessionService(redis);
});
afterAll(async () => {
  await redis.quit();
});

describe("SessionService", () => {
  it("creates and reads back a session", async () => {
    const { sid, session } = await sessions.create(42);
    const found = await sessions.get(sid);

    expect(found?.userId).toBe(42);
    expect(found?.csrfToken).toBe(session.csrfToken);
    expect(session.csrfToken).toHaveLength(43); // 32 random bytes, base64url
    await sessions.destroy(sid);
  });

  it("returns null for an unknown sid rather than throwing", async () => {
    expect(await sessions.get(`missing-${randomUUID()}`)).toBeNull();
  });

  it("makes a destroyed session unreadable", async () => {
    const { sid } = await sessions.create(7);
    await sessions.destroy(sid);
    expect(await sessions.get(sid)).toBeNull();
  });

  it("invalidates the previous session on a new login", async () => {
    const first = await sessions.create(99);
    await sessions.destroyForUser(99);
    const second = await sessions.create(99);

    expect(await sessions.get(first.sid)).toBeNull();
    expect(await sessions.get(second.sid)).not.toBeNull();
    await sessions.destroy(second.sid);
  });

  it("issues unpredictable, distinct session ids", async () => {
    const a = await sessions.create(1);
    const b = await sessions.create(1);
    expect(a.sid).not.toBe(b.sid);
    expect(a.sid).toHaveLength(43);
    await sessions.destroy(a.sid);
    await sessions.destroy(b.sid);
  });

  it("slides the TTL on read", async () => {
    const { sid } = await sessions.create(5);
    await redis.expire(`iknos:sess:${sid}`, 10);
    await sessions.get(sid);

    const ttl = await redis.ttl(`iknos:sess:${sid}`);
    expect(ttl).toBeGreaterThan(60);
    await sessions.destroy(sid);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/api/src/auth/session`
Expected: FAIL — cannot resolve `./session.service`.

- [ ] **Step 3: Implement it**

`apps/api/src/auth/session.service.ts`:

```ts
import { randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type Redis from "ioredis";

const TTL_SECONDS = 2 * 60 * 60; // 2h, vs PFA's 10min: a dashboard lives in a tab
const SESSION_PREFIX = "iknos:sess:";
const USER_PREFIX = "iknos:user:";

export type Session = { userId: number; csrfToken: string };

function token(): string {
  return randomBytes(32).toString("base64url");
}

@Injectable()
export class SessionService {
  constructor(private readonly redis: Redis) {}

  async create(userId: number): Promise<{ sid: string; session: Session }> {
    const sid = token();
    const session: Session = { userId, csrfToken: token() };

    await this.redis.setex(`${SESSION_PREFIX}${sid}`, TTL_SECONDS, JSON.stringify(session));
    // Tracking the current sid per user is what makes one-session-per-user
    // possible without scanning the keyspace.
    await this.redis.setex(`${USER_PREFIX}${userId}:sid`, TTL_SECONDS, sid);

    return { sid, session };
  }

  /** Slides the TTL. Returns null for anything unknown, expired or corrupt —
   *  a bad cookie is a logout, never a 500. */
  async get(sid: string): Promise<Session | null> {
    const key = `${SESSION_PREFIX}${sid}`;
    const raw = await this.redis.get(key);
    if (!raw) return null;

    let session: Session;
    try {
      session = JSON.parse(raw) as Session;
    } catch {
      await this.redis.del(key);
      return null;
    }

    await this.redis.expire(key, TTL_SECONDS);
    await this.redis.expire(`${USER_PREFIX}${session.userId}:sid`, TTL_SECONDS);
    return session;
  }

  async destroy(sid: string): Promise<void> {
    const session = await this.get(sid);
    if (session) await this.redis.del(`${USER_PREFIX}${session.userId}:sid`);
    await this.redis.del(`${SESSION_PREFIX}${sid}`);
  }

  async destroyForUser(userId: number): Promise<void> {
    const key = `${USER_PREFIX}${userId}:sid`;
    const sid = await this.redis.get(key);
    if (sid) await this.redis.del(`${SESSION_PREFIX}${sid}`);
    await this.redis.del(key);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/api/src/auth`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth
git commit -m "feat(auth): redis session store with sliding ttl"
```

---

## Task 9: CSRF and the global session guard

**Files:**
- Create: `apps/api/src/auth/csrf.util.ts`, `apps/api/src/auth/csrf.util.spec.ts`, `apps/api/src/auth/public.decorator.ts`, `apps/api/src/auth/session.guard.ts`

**Interfaces:**
- Produces: `verifyCsrf(expected, provided): boolean` (constant time), the `@Public()` decorator, and `SessionGuard` registered as `APP_GUARD`. Handlers read `req.session` from here on.

- [ ] **Step 1: Write the failing CSRF test**

`apps/api/src/auth/csrf.util.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { verifyCsrf } from "./csrf.util";

describe("verifyCsrf", () => {
  it("accepts the matching token", () => {
    expect(verifyCsrf("abc123", "abc123")).toBe(true);
  });

  it("rejects a different token of the same length", () => {
    expect(verifyCsrf("abc123", "abc124")).toBe(false);
  });

  it("rejects a prefix", () => {
    expect(verifyCsrf("abc123", "abc")).toBe(false);
  });

  it("rejects empty tokens, including two of them", () => {
    expect(verifyCsrf("abc123", "")).toBe(false);
    expect(verifyCsrf("", "abc123")).toBe(false);
    // A session with no token must never let a tokenless request through.
    expect(verifyCsrf("", "")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/api/src/auth/csrf`
Expected: FAIL — cannot resolve `./csrf.util`.

- [ ] **Step 3: Implement it**

`apps/api/src/auth/csrf.util.ts` — same shape as PFA's `csrf-token.util.ts`:

```ts
import { timingSafeEqual } from "node:crypto";

export function verifyCsrf(expected: string, provided: string): boolean {
  if (!expected || !provided) return false;

  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  // timingSafeEqual throws on length mismatch, so this must be checked first.
  // Not a meaningful leak: the token length is fixed and public.
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Write the guard**

`apps/api/src/auth/public.decorator.ts`:

```ts
import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC = "iknos:public";
export const Public = () => SetMetadata(IS_PUBLIC, true);
```

`apps/api/src/auth/session.guard.ts`:

```ts
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { verifyCsrf } from "./csrf.util";
import { IS_PUBLIC } from "./public.decorator";
import { SessionService } from "./session.service";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
export const COOKIE_NAME = "iknos.sid";
export const CSRF_HEADER = "x-csrf-token";

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const sid = req.signedCookies?.[COOKIE_NAME];
    if (!sid) throw new UnauthorizedException();

    const session = await this.sessions.get(sid);
    if (!session) throw new UnauthorizedException();

    // CSRF applies to every unsafe verb, not just POST.
    if (!SAFE_METHODS.has(req.method)) {
      if (!verifyCsrf(session.csrfToken, req.headers[CSRF_HEADER] ?? "")) {
        throw new ForbiddenException();
      }
    }

    req.session = session;
    return true;
  }
}
```

Register it globally in `AppModule`:

```ts
providers: [{ provide: APP_GUARD, useClass: SessionGuard }]
```

Global, never per-controller: a controller added six months from now is protected because it exists, not because someone remembered.

In `main.ts`, add `app.use(cookieParser(config.cookieSecret))` so `req.signedCookies` is populated.

- [ ] **Step 5: Verify the default-deny property**

Add a temporary controller with no decorator, confirm `curl` gets 401, then delete it. Better still, keep it as a test in Task 10's e2e suite so the property stays enforced.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth
git commit -m "feat(auth): global session guard with constant-time csrf check"
```

---

## Task 10: Auth controller, rate limiting and the user CLI

**Files:**
- Create: `apps/api/src/auth/auth.controller.ts`, `apps/api/src/auth/ratelimit.service.ts`, `apps/api/src/auth/users.service.ts`, `packages/db/src/seed-user.ts`, `apps/api/test/auth.e2e-spec.ts`

**Interfaces:**
- Produces: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/csrf`, `GET /api/me`. Every later route sits behind the guard these establish.

`POST /api/auth/login` is `@Public()` and carries **no** CSRF check — there is no session yet to mint a token from. `SameSite=Lax` is what protects it from cross-site submission.

- [ ] **Step 1: Write the failing test**

`apps/api/test/auth.e2e-spec.ts`:

```ts
import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers";

describe("auth", () => {
  it("401s every protected route without a session", async () => {
    const app = await buildTestApp();
    for (const url of ["/api/me", "/api/csrf", "/api/services", "/api/logs"]) {
      await request(app.getHttpServer()).get(url).expect(401);
    }
  });

  it("does not reveal whether an account exists", async () => {
    const app = await buildTestApp();
    const res = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: "nobody@example.com", password: "wrong-password-here" })
      .expect(401);

    expect(JSON.stringify(res.body)).not.toMatch(/email|account|user/i);
  });

  it("sets a hardened cookie on success", async () => {
    const app = await buildTestApp();
    const res = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: "test@iknos.local", password: "test-password-1234" })
      .expect(201);

    const cookie = res.headers["set-cookie"][0];
    expect(cookie).toMatch(/^iknos\.sid=/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
  });

  it("403s a mutation with a valid session but no CSRF token", async () => {
    const app = await buildTestApp();
    const login = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: "test@iknos.local", password: "test-password-1234" });
    const cookie = login.headers["set-cookie"];

    // 403, not 401 — the session is fine, the request forgery protection is not.
    await request(app.getHttpServer()).post("/api/auth/logout").set("Cookie", cookie).expect(403);
  });

  it("429s after five failed attempts in a minute", async () => {
    const app = await buildTestApp();
    const attempt = () =>
      request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ email: "test@iknos.local", password: "definitely-wrong" });

    for (let i = 0; i < 5; i++) await attempt().expect(401);
    await attempt().expect(429);
  });
});
```

`apps/api/test/helpers.ts` builds the app from `AppModule`, applies `cookieParser`, and returns it. The rate-limit test needs a distinct client IP per run or a Redis flush of the `iknos:rl:` prefix in `beforeEach`, otherwise reruns start already throttled.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/api/test/auth`
Expected: FAIL — routes 404.

- [ ] **Step 3: Implement the rate limiter**

`apps/api/src/auth/ratelimit.service.ts`:

```ts
import { Injectable } from "@nestjs/common";
import type Redis from "ioredis";

const MAX_ATTEMPTS = 5;
const WINDOW_SECONDS = 60;

@Injectable()
export class RateLimitService {
  constructor(private readonly redis: Redis) {}

  /** Fixed window. Returns false once the budget is spent. */
  async allow(ip: string): Promise<boolean> {
    const key = `iknos:rl:login:${ip}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      // Only the first call in a window sets the expiry, so a burst cannot keep
      // pushing the window forward and lock the caller out indefinitely.
      await this.redis.expire(key, WINDOW_SECONDS);
    }
    return count <= MAX_ATTEMPTS;
  }
}
```

- [ ] **Step 4: Implement the controller**

`apps/api/src/auth/auth.controller.ts` — the shape below, with `bcryptjs` for hashing:

```ts
@Public()
@Post("api/auth/login")
async login(@Body() body: LoginDto, @Req() req, @Res({ passthrough: true }) res) {
  if (!(await this.rateLimit.allow(req.ip))) throw new HttpException("", 429);

  const user = await this.users.findByEmail(body.email);
  // Compare against a dummy hash when the account is missing, so a nonexistent
  // account and a wrong password cost the same time and return the same body.
  const ok = user
    ? await bcrypt.compare(body.password, user.passwordHash)
    : (await bcrypt.compare(body.password, DUMMY_HASH), false);
  if (!user || !ok) throw new UnauthorizedException();

  await this.sessions.destroyForUser(user.id);           // one session per user
  const { sid, session } = await this.sessions.create(user.id);

  res.cookie(COOKIE_NAME, sid, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    signed: true,
    maxAge: 2 * 60 * 60 * 1000,
  });

  return { userId: user.id, csrfToken: session.csrfToken };
}
```

`logout` destroys the session and clears the cookie; `GET /api/csrf` returns `req.session.csrfToken`; `GET /api/me` returns `{ userId }`. Generate `DUMMY_HASH` once with `bcrypt.hashSync("a password nobody has", 10)` and paste the real value.

Trust the proxy so `req.ip` is the real client: `app.set("trust proxy", 1)` in `main.ts`, paired with nginx setting `X-Forwarded-For` in Task 23. Without both, every request looks like `127.0.0.1` and five failures lock out everyone.

- [ ] **Step 5: Add the user CLI**

`packages/db/src/seed-user.ts` — reads an email argument, prompts twice for a password without echoing, rejects anything under 12 characters, hashes with bcrypt, inserts. Wire it as `pnpm seed:user`. No public registration, no `POST /users`.

- [ ] **Step 6: Run the tests, then check from outside**

Run: `pnpm seed:user test@iknos.local` then `pnpm vitest run apps/api/test/auth`
Expected: PASS, 5 tests.

Then with the server up:

```bash
curl -si localhost:4310/api/me | head -1
```

Expected: `HTTP/1.1 401 Unauthorized`. This is the spec's acceptance criterion — verified in `curl`, not only in a browser.

- [ ] **Step 7: Commit**

```bash
git add apps/api packages/db
git commit -m "feat(auth): login, logout, csrf, me and login rate limiting"
```

---

## Task 11: Line framing

**Files:**
- Create: `apps/api/src/ingest/line-buffer.ts`, `apps/api/src/ingest/line-buffer.spec.ts`

**Interfaces:**
- Produces: `LineBuffer` with `push(chunk: Buffer)`, `nextLine(): string | null`, `pendingBytes: number`, and `MAX_LINE_BYTES`. Task 13's tailer feeds it; Task 12's parser consumes its output.

The smallest piece of the project and the one most worth getting exactly right. In Rust the type system made this safe for free; in Node it is a convention, so it needs tests.

- [ ] **Step 1: Write the failing test**

`apps/api/src/ingest/line-buffer.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { LineBuffer, MAX_LINE_BYTES } from "./line-buffer";

describe("LineBuffer", () => {
  it("yields complete lines only", () => {
    const b = new LineBuffer();
    b.push(Buffer.from("first\nsecond\npartial"));

    expect(b.nextLine()).toBe("first");
    expect(b.nextLine()).toBe("second");
    expect(b.nextLine()).toBeNull();
    expect(b.pendingBytes).toBe("partial".length);
  });

  it("reassembles a line split across reads", () => {
    const b = new LineBuffer();
    b.push(Buffer.from("hello "));
    expect(b.nextLine()).toBeNull();
    b.push(Buffer.from("world\n"));
    expect(b.nextLine()).toBe("hello world");
  });

  it("survives a read that splits a UTF-8 codepoint", () => {
    // "é" is 0xC3 0xA9. A read boundary between the two bytes is exactly what
    // chunk.toString() turns into U+FFFD, silently and undetectably.
    const b = new LineBuffer();
    b.push(Buffer.from([0x63, 0x61, 0x66, 0xc3]));
    expect(b.nextLine()).toBeNull();
    b.push(Buffer.from([0xa9, 0x0a]));
    expect(b.nextLine()).toBe("café");
  });

  it("strips a trailing carriage return", () => {
    const b = new LineBuffer();
    b.push(Buffer.from("windows\r\n"));
    expect(b.nextLine()).toBe("windows");
  });

  it("yields empty lines rather than swallowing them", () => {
    const b = new LineBuffer();
    b.push(Buffer.from("\n\na\n"));
    expect(b.nextLine()).toBe("");
    expect(b.nextLine()).toBe("");
    expect(b.nextLine()).toBe("a");
  });

  it("replaces genuinely invalid UTF-8 without failing", () => {
    const b = new LineBuffer();
    b.push(Buffer.from([0x61, 0xff, 0x62, 0x0a]));
    const line = b.nextLine();
    expect(line?.startsWith("a")).toBe(true);
    expect(line?.endsWith("b")).toBe(true);
  });

  it("drops the buffer if a single line grows absurd", () => {
    const b = new LineBuffer();
    b.push(Buffer.alloc(MAX_LINE_BYTES + 1, 0x78));
    expect(b.pendingBytes).toBe(0);
  });
});
```

The last test guards a file with no newlines at all: without a cap the heap grows until the process dies.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/api/src/ingest/line-buffer`
Expected: FAIL — cannot resolve `./line-buffer`.

- [ ] **Step 3: Implement it**

`apps/api/src/ingest/line-buffer.ts`:

```ts
/** A single log line longer than this is garbage, not something to buffer.
 *  Real ECS lines are a few kilobytes at most. */
export const MAX_LINE_BYTES = 1024 * 1024;

const LF = 0x0a;
const CR = 0x0d;

export class LineBuffer {
  private buf: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): void {
    this.buf = this.buf.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buf, chunk]);

    if (this.buf.length > MAX_LINE_BYTES && !this.buf.includes(LF)) {
      this.buf = Buffer.alloc(0);
    }
  }

  /**
   * Returns the next complete line, or null if no newline has arrived yet.
   * Bytes stay bytes until a whole line exists — decoding a partial read would
   * turn a split codepoint into U+FFFD with no error and no way to notice.
   */
  nextLine(): string | null {
    const idx = this.buf.indexOf(LF);
    if (idx === -1) return null;

    let end = idx;
    if (end > 0 && this.buf[end - 1] === CR) end--;

    const line = this.buf.subarray(0, end).toString("utf8");
    // A view, not a copy. The next push() concatenates into a fresh allocation,
    // so the original chunk is released then; nothing accumulates.
    this.buf = this.buf.subarray(idx + 1);
    return line;
  }

  get pendingBytes(): number {
    return this.buf.length;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/api/src/ingest/line-buffer`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ingest
git commit -m "feat(ingest): byte-safe line framing across read boundaries"
```

---

## Task 12: Log line parser

**Files:**
- Create: `apps/api/src/ingest/parser.ts`, `apps/api/src/ingest/parser.spec.ts`, `packages/contracts/src/log-record.ts`

**Interfaces:**
- Produces: `LogRecord` (the shape crossing every boundary) and `parse(line: string, service: string, stream: "out" | "err"): LogRecord | null`. `null` means the line was deliberately skipped. Tasks 14 and 17 both carry `LogRecord`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/ingest/parser.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { INGEST_SKIP_MARKER } from "../common/logger";
import { parse } from "./parser";

const out = (line: string) => {
  const r = parse(line, "pfa-api", "out");
  if (!r) throw new Error("expected a record");
  return r;
};

describe("parse", () => {
  it("reads ECS with dotted keys", () => {
    const r = out(
      '{"@timestamp":"2026-08-09T10:11:12.345Z","log.level":"error","message":"boom",' +
        '"trace.id":"abc","http.request.method":"GET","url.path":"/api/users",' +
        '"http.response.status_code":500,"client.ip":"1.2.3.4"}',
    );

    expect(r.levelName).toBe("error");
    expect(r.level).toBe(50);
    expect(r.message).toBe("boom");
    expect(r.traceId).toBe("abc");
    expect(r.httpMethod).toBe("GET");
    expect(r.route).toBe("/api/users");
    expect(r.statusCode).toBe(500);
    expect(r.clientIp).toBe("1.2.3.4");
    expect(r.ts.toISOString()).toBe("2026-08-09T10:11:12.345Z");
  });

  it("reads ECS with nested keys", () => {
    // The ECS spec allows both shapes and loggers differ. Accept both.
    const r = out(
      '{"@timestamp":"2026-08-09T10:11:12.345Z","log":{"level":"warn","logger":"http"},' +
        '"message":"slow","trace":{"id":"xyz"}}',
    );

    expect(r.levelName).toBe("warn");
    expect(r.level).toBe(40);
    expect(r.logger).toBe("http");
    expect(r.traceId).toBe("xyz");
  });

  it("keeps unknown fields in attrs and does not duplicate promoted ones", () => {
    const r = out(
      '{"@timestamp":"2026-08-09T10:11:12.345Z","log.level":"info","message":"m","orderId":42}',
    );
    expect(r.attrs?.orderId).toBe(42);
    expect(r.attrs?.message).toBeUndefined();
  });

  it("falls back for JSON without ECS", () => {
    const r = out('{"msg":"hello","pid":17}');
    expect(r.message).toBe("hello");
    expect(r.attrs?.pid).toBe(17);
  });

  it("treats plain text as a message", () => {
    const r = out("Server started on port 3000");
    expect(r.message).toBe("Server started on port 3000");
    expect(r.levelName).toBe("info");
  });

  it("infers error level from the stream", () => {
    expect(parse("something failed", "pfa-api", "err")?.levelName).toBe("error");
  });

  it("refines level from a common prefix", () => {
    expect(out("WARN  deprecation notice").levelName).toBe("warn");
  });

  it("strips ANSI escapes", () => {
    const r = out("[32m[Nest][0m started");
    expect(r.message).not.toContain("");
    expect(r.message).toContain("[Nest]");
  });

  it("stores truncated JSON as plain text rather than throwing", () => {
    const r = out('{"@timestamp":"2026-08-09T10:11:12.345Z","mess');
    expect(r.message.startsWith("{")).toBe(true);
    expect(r.levelName).toBe("info");
  });

  it("skips the self-error marker", () => {
    // Otherwise a database outage becomes an infinite loop.
    expect(parse(`${INGEST_SKIP_MARKER} database unreachable`, "iknos", "err")).toBeNull();
  });

  it("falls back to now when the timestamp is unparseable", () => {
    const before = Date.now();
    const r = out('{"@timestamp":"not-a-date","log.level":"info","message":"m"}');
    expect(r.ts.getTime()).toBeGreaterThanOrEqual(before - 2000);
  });

  it("skips a blank line", () => {
    expect(parse("   ", "pfa-api", "out")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/api/src/ingest/parser`
Expected: FAIL — cannot resolve `./parser`.

- [ ] **Step 3: Define the record type**

`packages/contracts/src/log-record.ts`:

```ts
export type LogRecord = {
  ts: Date;
  service: string;
  level: number;
  levelName: string;
  logger: string | null;
  message: string;
  traceId: string | null;
  httpMethod: string | null;
  route: string | null;
  statusCode: number | null;
  durationMs: number | null;
  clientIp: string | null;
  userId: string | null;
  hostname: string | null;
  attrs: Record<string, unknown> | null;
};
```

- [ ] **Step 4: Implement the parser**

`apps/api/src/ingest/parser.ts`:

```ts
import type { LogRecord } from "@iknos/contracts";
import stripAnsi from "strip-ansi";
import { INGEST_SKIP_MARKER } from "../common/logger";

/** pino's numeric levels, which the UI sorts and filters on. */
const LEVELS: Record<string, number> = {
  trace: 10, debug: 20, info: 30, warn: 40, warning: 40,
  error: 50, fatal: 60, crit: 60, critical: 60,
};

const PROMOTED = [
  "@timestamp", "log.level", "log.logger", "message", "trace.id",
  "http.request.method", "url.path", "http.response.status_code",
  "event.duration", "client.ip", "user.id", "host.hostname", "ecs.version",
];

/** Looks a key up in both ECS shapes: dotted ("log.level") and nested. */
function lookup(obj: Record<string, unknown>, dotted: string): unknown {
  if (dotted in obj) return obj[dotted];

  const parts = dotted.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

const asString = (v: unknown) => (typeof v === "string" ? v : null);
const asNumber = (v: unknown) => (typeof v === "number" ? v : null);

function inferLevel(message: string, fallback: string): string {
  const head = message.slice(0, 24).toUpperCase();
  for (const [needle, level] of [
    ["FATAL", "fatal"], ["ERROR", "error"], ["ERR", "error"],
    ["WARN", "warn"], ["DEBUG", "debug"], ["TRACE", "trace"],
  ] as const) {
    if (head.includes(needle)) return level;
  }
  return fallback;
}

function plainText(message: string, service: string, fallback: string): LogRecord {
  const levelName = inferLevel(message, fallback);
  return {
    ts: new Date(), service, level: LEVELS[levelName] ?? 30, levelName,
    logger: null, message, traceId: null, httpMethod: null, route: null,
    statusCode: null, durationMs: null, clientIp: null, userId: null,
    hostname: null, attrs: null,
  };
}

export function parse(
  line: string,
  service: string,
  stream: "out" | "err",
): LogRecord | null {
  // Never re-ingest our own write failures.
  if (line.includes(INGEST_SKIP_MARKER)) return null;

  const clean = stripAnsi(line).trim();
  if (clean === "") return null;

  const fallbackLevel = stream === "err" ? "error" : "info";

  let obj: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(clean);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return plainText(clean, service, fallbackLevel);
    }
    obj = parsed as Record<string, unknown>;
  } catch {
    return plainText(clean, service, fallbackLevel);
  }

  const isEcs = "@timestamp" in obj || lookup(obj, "log.level") !== undefined;
  if (!isEcs) {
    const message = asString(obj.msg) ?? asString(obj.message) ?? clean;
    return { ...plainText(message, service, fallbackLevel), attrs: obj };
  }

  const levelName = asString(lookup(obj, "log.level")) ?? fallbackLevel;
  const rawTs = asString(obj["@timestamp"]);
  const parsedTs = rawTs ? new Date(rawTs) : null;
  const ts = parsedTs && !Number.isNaN(parsedTs.getTime()) ? parsedTs : new Date();

  // Whatever becomes a column is removed from attrs, so nothing is stored twice.
  const attrs: Record<string, unknown> = { ...obj };
  for (const key of PROMOTED) {
    delete attrs[key];
    const root = key.split(".")[0];
    if (key.includes(".")) delete attrs[root];
  }

  const durationNs = asNumber(lookup(obj, "event.duration"));

  return {
    ts,
    service,
    level: LEVELS[levelName] ?? 30,
    levelName,
    logger: asString(lookup(obj, "log.logger")),
    message: asString(obj.message) ?? "",
    traceId: asString(lookup(obj, "trace.id")),
    httpMethod: asString(lookup(obj, "http.request.method")),
    route: asString(lookup(obj, "url.path")),
    statusCode: asNumber(lookup(obj, "http.response.status_code")),
    // ECS event.duration is nanoseconds.
    durationMs: durationNs === null ? null : Math.round(durationNs / 1_000_000),
    clientIp: asString(lookup(obj, "client.ip")),
    userId: asString(lookup(obj, "user.id")),
    hostname: asString(lookup(obj, "host.hostname")),
    attrs: Object.keys(attrs).length > 0 ? attrs : null,
  };
}
```

`JSON.parse` here is safe from the event-loop rule because Task 11 caps a line at 1 MB before it ever reaches this function.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run apps/api/src/ingest`
Expected: PASS, 19 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/ingest packages/contracts
git commit -m "feat(ingest): ECS, bare JSON and plain text line parsing"
```

---

## Task 13: Rotation logic and the tailer loop

**Files:**
- Create: `apps/api/src/ingest/rotation.ts`, `apps/api/src/ingest/rotation.spec.ts`, `apps/api/src/ingest/tailer.ts`

**Interfaces:**
- Produces: `decide(stored: StoredOffset | null, now: FileStat): Action` (pure), and `Tailer` with `poll(): Promise<void>`. Task 15 drives `poll` on an interval.

The decision is pulled out as a pure function so every rotation case is testable without a filesystem. The I/O around it stays thin.

- [ ] **Step 1: Write the failing test**

`apps/api/src/ingest/rotation.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decide } from "./rotation";

const stored = { dev: 1n, inode: 100n, byteOffset: 500n };

describe("decide", () => {
  it("resumes when the file is unchanged and has grown", () => {
    expect(decide(stored, { dev: 1n, inode: 100n, len: 900n })).toEqual({
      kind: "read", from: 500n,
    });
  });

  it("does nothing when there is nothing new", () => {
    expect(decide(stored, { dev: 1n, inode: 100n, len: 500n })).toEqual({ kind: "idle" });
  });

  it("restarts from zero when the inode changed", () => {
    expect(decide(stored, { dev: 1n, inode: 101n, len: 20n })).toEqual({
      kind: "restart", from: 0n,
    });
  });

  it("restarts from zero when the device changed", () => {
    // Inode numbers repeat across filesystems often enough that dev must be
    // part of the identity.
    expect(decide(stored, { dev: 2n, inode: 100n, len: 900n })).toEqual({
      kind: "restart", from: 0n,
    });
  });

  it("restarts from zero when the file was truncated", () => {
    expect(decide(stored, { dev: 1n, inode: 100n, len: 12n })).toEqual({
      kind: "restart", from: 0n,
    });
  });

  it("reads a brand new file from the start", () => {
    expect(decide(null, { dev: 1n, inode: 100n, len: 42n })).toEqual({
      kind: "restart", from: 0n,
    });
  });

  it("treats an empty new file as idle, not a read of nothing", () => {
    expect(decide(null, { dev: 1n, inode: 100n, len: 0n })).toEqual({ kind: "idle" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/api/src/ingest/rotation`
Expected: FAIL — cannot resolve `./rotation`.

- [ ] **Step 3: Implement the decision**

`apps/api/src/ingest/rotation.ts`:

```ts
export type StoredOffset = { dev: bigint; inode: bigint; byteOffset: bigint };
export type FileStat = { dev: bigint; inode: bigint; len: bigint };

export type Action =
  | { kind: "idle" }
  | { kind: "read"; from: bigint }
  | { kind: "restart"; from: bigint };

export function decide(stored: StoredOffset | null, now: FileStat): Action {
  if (stored === null) {
    return now.len === 0n ? { kind: "idle" } : { kind: "restart", from: 0n };
  }

  const replaced = stored.dev !== now.dev || stored.inode !== now.inode;
  const truncated = now.len < stored.byteOffset;

  if (replaced || truncated) {
    return now.len === 0n ? { kind: "idle" } : { kind: "restart", from: 0n };
  }
  if (now.len > stored.byteOffset) return { kind: "read", from: stored.byteOffset };
  return { kind: "idle" };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/api/src/ingest/rotation`
Expected: PASS, 7 tests.

- [ ] **Step 5: Implement the tailer**

`apps/api/src/ingest/tailer.ts`:

```ts
import { open, stat } from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";
import { LineBuffer } from "./line-buffer";
import { parse } from "./parser";
import { decide, type StoredOffset } from "./rotation";
import type { Chunk } from "./writer";

const READ_CHUNK = 256 * 1024;

/** PM2 names its files `<app>-out.log` and `<app>-error.log`. */
function serviceAndStream(file: string): { service: string; stream: "out" | "err" } {
  const stem = path.basename(file, path.extname(file));
  if (stem.endsWith("-error")) return { service: stem.slice(0, -6), stream: "err" };
  if (stem.endsWith("-out")) return { service: stem.slice(0, -4), stream: "out" };
  return { service: stem, stream: "out" };
}

export class Tailer {
  private readonly state = new Map<string, { offset: StoredOffset; buffer: LineBuffer }>();

  constructor(
    private readonly pattern: string,
    private readonly submit: (chunk: Chunk) => void,
  ) {}

  hydrate(offsets: StoredOffset[] & { filePath: string }[]): void {
    for (const o of offsets) {
      this.state.set(o.filePath, { offset: o, buffer: new LineBuffer() });
    }
  }

  /** One pass over every matching file. Called on a 1s interval by Task 15. */
  async poll(): Promise<void> {
    // Re-globbing each tick is how a newly deployed PM2 app is picked up
    // without restarting Iknos.
    const files = await glob(this.pattern);

    for (const file of files) {
      try {
        await this.pollOne(file);
      } catch {
        // A file that vanished mid-poll is normal during rotation. Never let
        // one bad file stop the others.
      }
    }
  }

  private async pollOne(file: string): Promise<void> {
    const st = await stat(file, { bigint: true });
    const now = { dev: st.dev, inode: st.ino, len: st.size };

    let entry = this.state.get(file);
    const action = decide(entry?.offset ?? null, now);
    if (action.kind === "idle") return;

    if (!entry || action.kind === "restart") {
      // A replaced file means any carried partial line belongs to a file that
      // no longer exists. Discarding it is correct.
      entry = { offset: { ...now, byteOffset: 0n }, buffer: new LineBuffer() };
      this.state.set(file, entry);
    }

    const { service, stream } = serviceAndStream(file);
    const fh = await open(file, "r");
    try {
      let pos = action.from;
      const buf = Buffer.alloc(READ_CHUNK);

      for (;;) {
        const { bytesRead } = await fh.read(buf, 0, READ_CHUNK, Number(pos));
        if (bytesRead === 0) break;

        pos += BigInt(bytesRead);
        entry.buffer.push(buf.subarray(0, bytesRead));

        const records = [];
        for (let line = entry.buffer.nextLine(); line !== null; line = entry.buffer.nextLine()) {
          const record = parse(line, service, stream);
          if (record) records.push(record);
        }
        if (records.length === 0) continue;

        // Report the position of the last complete line, not the read head:
        // bytes still in the buffer have not been stored anywhere.
        const committed = pos - BigInt(entry.buffer.pendingBytes);
        this.submit({
          records,
          offset: { filePath: file, dev: now.dev, inode: now.inode, byteOffset: committed },
        });
      }

      entry.offset = { dev: now.dev, inode: now.inode, byteOffset: pos };
    } finally {
      await fh.close();
    }
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/ingest
git commit -m "feat(ingest): rotation decision and tailer loop"
```

---

## Task 14: Bounded queue and the transactional writer

**Files:**
- Create: `apps/api/src/ingest/writer.ts`, `apps/api/src/ingest/writer.spec.ts`, `apps/api/test/durability.e2e-spec.ts`

**Interfaces:**
- Produces: `Writer` with `submit(chunk: Chunk): void`, `flush(): Promise<void>`, `dropped: number`, and `Chunk = { records: LogRecord[]; offset: OffsetRow }`. Task 15 owns its lifecycle.

- [ ] **Step 1: Write the failing tests**

`apps/api/src/ingest/writer.spec.ts` — backpressure, with no database:

```ts
import { describe, expect, it, vi } from "vitest";
import { MAX_QUEUED_RECORDS, Writer } from "./writer";

const record = (message: string) =>
  ({ ts: new Date(), service: "t", level: 30, levelName: "info", logger: null,
     message, traceId: null, httpMethod: null, route: null, statusCode: null,
     durationMs: null, clientIp: null, userId: null, hostname: null, attrs: null }) as never;

const chunk = (n: number) => ({
  records: Array.from({ length: n }, (_, i) => record(`line ${i}`)),
  offset: { filePath: "/tmp/a.log", dev: 1n, inode: 2n, byteOffset: 10n },
});

describe("Writer backpressure", () => {
  it("drops and counts rather than growing without bound", () => {
    const w = new Writer({ persist: vi.fn() } as never, { emit: vi.fn() } as never);

    for (let i = 0; i < 50; i++) w.submit(chunk(MAX_QUEUED_RECORDS / 10));

    expect(w.queuedRecords).toBeLessThanOrEqual(MAX_QUEUED_RECORDS);
    expect(w.dropped).toBeGreaterThan(0);
  });

  it("does not drop under normal load", () => {
    const w = new Writer({ persist: vi.fn() } as never, { emit: vi.fn() } as never);
    w.submit(chunk(10));
    expect(w.dropped).toBe(0);
  });
});
```

`apps/api/test/durability.e2e-spec.ts` — the property that matters, against a real database:

```ts
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@iknos/db";
import { persistBatch } from "../src/ingest/writer";

const record = (service: string, message: string, levelName = "info") =>
  ({ ts: new Date(), service, level: 30, levelName, logger: null, message,
     traceId: null, httpMethod: null, route: null, statusCode: null,
     durationMs: null, clientIp: null, userId: null, hostname: null, attrs: null }) as never;

describe("persistBatch", () => {
  it("lands rows and the offset together", async () => {
    const service = `t-${randomUUID().slice(0, 8)}`;
    const filePath = `/tmp/${service}.log`;

    await persistBatch(
      Array.from({ length: 250 }, (_, i) => record(service, `line ${i}`)),
      [{ filePath, dev: 1n, inode: 2n, byteOffset: 4096n }],
    );

    expect(await prisma.logEntry.count({ where: { service } })).toBe(250);
    const offset = await prisma.ingestOffset.findUnique({ where: { filePath } });
    expect(offset?.byteOffset).toBe(4096n);
  });

  it("leaves no rows and no offset when the batch fails", async () => {
    const service = `t-${randomUUID().slice(0, 8)}`;
    const filePath = `/tmp/${service}.log`;

    // levelName is VARCHAR(16); an over-long value makes the INSERT fail.
    const bad = record(service, "doomed", "x".repeat(64));

    await expect(
      persistBatch([bad], [{ filePath, dev: 1n, inode: 2n, byteOffset: 99n }]),
    ).rejects.toThrow();

    expect(await prisma.logEntry.count({ where: { service } })).toBe(0);
    expect(await prisma.ingestOffset.findUnique({ where: { filePath } })).toBeNull();
  });
});
```

The second test is the whole point. It proves a crash or a database error cannot silently skip log lines, because the offset can never run ahead of the data.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run apps/api/src/ingest/writer apps/api/test/durability`
Expected: FAIL — cannot resolve `./writer`.

- [ ] **Step 3: Implement it**

`apps/api/src/ingest/writer.ts`:

```ts
import { prisma } from "@iknos/db";
import type { LogRecord } from "@iknos/contracts";
import { INGEST_SKIP_MARKER } from "../common/logger";
import type { LogBus } from "../stream/log-bus";

const MAX_ROWS_PER_FLUSH = 200;
export const FLUSH_INTERVAL_MS = 500;

/** The ceiling that keeps a log burst from becoming an OOM. Node has no
 *  bounded channel to lean on, so this is checked by hand on every push. */
export const MAX_QUEUED_RECORDS = 20_000;

export type OffsetRow = { filePath: string; dev: bigint; inode: bigint; byteOffset: bigint };
export type Chunk = { records: LogRecord[]; offset: OffsetRow };

/** Rows and the offset that accounts for them, in one transaction. That
 *  atomicity — not careful ordering — is what gives no-loss-no-duplicate. */
export async function persistBatch(records: LogRecord[], offsets: OffsetRow[]): Promise<void> {
  if (records.length === 0 && offsets.length === 0) return;

  await prisma.$transaction([
    prisma.logEntry.createMany({ data: records as never }),
    ...offsets.map((o) =>
      prisma.ingestOffset.upsert({
        where: { filePath: o.filePath },
        create: o,
        update: { dev: o.dev, inode: o.inode, byteOffset: o.byteOffset },
      }),
    ),
  ]);
}

export class Writer {
  private queue: LogRecord[] = [];
  private offsets = new Map<string, OffsetRow>();
  dropped = 0;

  constructor(
    private readonly db = { persist: persistBatch },
    private readonly bus?: LogBus,
  ) {}

  get queuedRecords(): number {
    return this.queue.length;
  }

  submit(chunk: Chunk): void {
    const room = MAX_QUEUED_RECORDS - this.queue.length;

    if (chunk.records.length > room) {
      this.dropped += chunk.records.length - Math.max(room, 0);
      // Losing log lines beats taking the host down with MySQL behind it.
      chunk.records = chunk.records.slice(0, Math.max(room, 0));
    }

    this.queue.push(...chunk.records);
    // Latest offset per file wins within a batch.
    this.offsets.set(chunk.offset.filePath, chunk.offset);
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0 && this.offsets.size === 0) return;

    const records = this.queue.splice(0, MAX_ROWS_PER_FLUSH);
    const offsets = [...this.offsets.values()];
    this.offsets.clear();

    try {
      await this.db.persist(records, offsets);
      // Publish only after the commit, so live tail never shows a rolled-back row.
      for (const r of records) this.bus?.emit(r);
    } catch (err) {
      // Straight to stderr with the marker, never through the logger: this is
      // the path that would otherwise log its own failure, ingest that log and
      // fail again. The offset was not committed, so the tailer re-reads these
      // bytes once the database is back.
      process.stderr.write(`${INGEST_SKIP_MARKER} failed to write batch: ${String(err)}\n`);
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/api/src/ingest apps/api/test/durability`
Expected: PASS — 2 backpressure tests, 2 durability tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(ingest): bounded queue and transactional batch writer"
```

---

## Task 15: Event bus and ingestion lifecycle

**Files:**
- Create: `apps/api/src/stream/log-bus.ts`, `apps/api/src/ingest/ingest.service.ts`, `apps/api/src/ingest/ingest.module.ts`, `apps/api/test/tail-roundtrip.e2e-spec.ts`

**Interfaces:**
- Produces: `LogBus` with `emit(record: LogRecord)` and `subscribe(fn): () => void` (returns an unsubscribe), and `IngestService` implementing `OnApplicationBootstrap` / `OnApplicationShutdown`. Task 17 subscribes to the bus.

- [ ] **Step 1: Write the failing integration test**

`apps/api/test/tail-roundtrip.e2e-spec.ts`:

```ts
import { randomUUID } from "node:crypto";
import { appendFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prisma } from "@iknos/db";
import { describe, expect, it } from "vitest";
import { IngestService } from "../src/ingest/ingest.service";
import { LogBus } from "../src/stream/log-bus";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("tail roundtrip", () => {
  it("gets a line written to a file into the database", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "iknos-"));
    const service = `t${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    const file = path.join(dir, `${service}-out.log`);
    await writeFile(file, "first line\n");

    const ingest = new IngestService(`${dir}/*.log`, new LogBus());
    await ingest.onApplicationBootstrap();

    // Append after startup, proving new bytes are picked up and not just the
    // contents present at boot.
    await sleep(1500);
    await appendFile(file, "second line\n");
    await sleep(2500);

    await ingest.onApplicationShutdown();

    expect(await prisma.logEntry.count({ where: { service } })).toBe(2);
  }, 20_000);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/api/test/tail-roundtrip`
Expected: FAIL — cannot resolve `../src/ingest/ingest.service`.

- [ ] **Step 3: Implement the bus**

`apps/api/src/stream/log-bus.ts`:

```ts
import { Injectable } from "@nestjs/common";
import { EventEmitter } from "node:events";
import type { LogRecord } from "@iknos/contracts";

@Injectable()
export class LogBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Each SSE connection adds a listener. The default cap of 10 would print a
    // spurious leak warning with a handful of open tabs.
    this.emitter.setMaxListeners(0);
  }

  emit(record: LogRecord): void {
    this.emitter.emit("log", record);
  }

  /** Returns an unsubscribe function. Callers MUST call it on disconnect —
   *  listeners accumulating on dead requests is the classic SSE memory leak. */
  subscribe(fn: (record: LogRecord) => void): () => void {
    this.emitter.on("log", fn);
    return () => this.emitter.off("log", fn);
  }
}
```

- [ ] **Step 4: Implement the lifecycle**

`apps/api/src/ingest/ingest.service.ts`:

```ts
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { prisma } from "@iknos/db";
import { logger } from "../common/logger";
import type { LogBus } from "../stream/log-bus";
import { Tailer } from "./tailer";
import { FLUSH_INTERVAL_MS, Writer } from "./writer";

const POLL_INTERVAL_MS = 1000;

@Injectable()
export class IngestService implements OnApplicationBootstrap, OnApplicationShutdown {
  private writer!: Writer;
  private tailer!: Tailer;
  private timers: NodeJS.Timeout[] = [];
  private polling = false;

  constructor(
    private readonly pattern: string,
    private readonly bus: LogBus,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.writer = new Writer(undefined, this.bus);
    this.tailer = new Tailer(this.pattern, (chunk) => this.writer.submit(chunk));

    const stored = await prisma.ingestOffset.findMany();
    this.tailer.hydrate(stored as never);

    this.timers.push(
      setInterval(() => void this.tick(), POLL_INTERVAL_MS),
      setInterval(() => void this.writer.flush(), FLUSH_INTERVAL_MS),
    );
  }

  /** Detection is stat-on-an-interval, not fs.watch: watch APIs are unreliable
   *  across filesystems and gain nothing at one second. */
  private async tick(): Promise<void> {
    // Never let two polls overlap. A slow disk would otherwise stack them until
    // the event loop — shared with the API — stops answering.
    if (this.polling) return;
    this.polling = true;
    try {
      await this.tailer.poll();
    } catch (err) {
      logger.error({ err }, "tailer poll failed");
    } finally {
      this.polling = false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    await this.writer.flush();
  }
}
```

Provide it in `IngestModule` with the pattern injected from config.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run apps/api/test/tail-roundtrip`
Expected: PASS. It takes about 5 seconds — the poll interval is wall-clock.

- [ ] **Step 6: Verify by hand**

With `IKNOS_PM2_LOG_GLOB=/tmp/iknos-demo*.log` and the server running:

```bash
echo '{"@timestamp":"2026-08-09T10:00:00.000Z","log.level":"info","message":"hello iknos"}' >> /tmp/iknos-demo-out.log
sleep 3 && mysql iknos -e "SELECT service, level_name, message FROM log_entry ORDER BY id DESC LIMIT 1"
```

Expected: one row, service `iknos-demo`, level `info`.

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(ingest): event bus and ingestion lifecycle"
```

---

## Task 16: Logs query endpoint

**Files:**
- Create: `apps/api/src/logs/cursor.ts`, `apps/api/src/logs/cursor.spec.ts`, `apps/api/src/logs/logs.service.ts`, `apps/api/src/logs/logs.controller.ts`, `apps/api/src/services.controller.ts`, `packages/contracts/src/log-page.ts`, `apps/api/test/logs.e2e-spec.ts`

**Interfaces:**
- Produces: `GET /api/logs`, `GET /api/services`, and the DTOs `LogRow` and `LogPage { rows: LogRow[]; nextCursor: string | null }` in `@iknos/contracts`. Tasks 17, 21 and 22 import those types.

- [ ] **Step 1: Write the failing tests**

`apps/api/src/logs/cursor.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "./cursor";

describe("cursor", () => {
  it("round-trips a timestamp and a BigInt id", () => {
    const ts = new Date("2026-08-09T10:11:12.345Z");
    const decoded = decodeCursor(encodeCursor(ts, 9007199254740993n));

    expect(decoded?.ts.getTime()).toBe(ts.getTime());
    // Beyond Number.MAX_SAFE_INTEGER: this is why the id is a string on the wire.
    expect(decoded?.id).toBe(9007199254740993n);
  });

  it("returns null for garbage rather than throwing", () => {
    expect(decodeCursor("not-a-cursor")).toBeNull();
    expect(decodeCursor("")).toBeNull();
  });
});
```

`apps/api/test/logs.e2e-spec.ts`:

```ts
import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildTestApp, login, seedLogs } from "./helpers";

const WIDE = "from=2020-01-01T00:00:00Z&to=2100-01-01T00:00:00Z";

describe("GET /api/logs", () => {
  it("rejects a query without a time range", async () => {
    const app = await buildTestApp();
    const cookie = await login(app);
    // An unbounded query would scan every partition.
    await request(app.getHttpServer()).get("/api/logs").set("Cookie", cookie).expect(400);
  });

  it("paginates without gaps or repeats", async () => {
    const app = await buildTestApp();
    const cookie = await login(app);
    const service = await seedLogs(120);

    const seen: string[] = [];
    let cursor: string | null = null;

    for (let i = 0; i < 10; i++) {
      const url = `/api/logs?${WIDE}&service=${service}&limit=50${cursor ? `&cursor=${cursor}` : ""}`;
      const res = await request(app.getHttpServer()).get(url).set("Cookie", cookie).expect(200);

      for (const row of res.body.rows) seen.push(row.message);
      cursor = res.body.nextCursor;
      if (!cursor) break;
    }

    expect(seen).toHaveLength(120);
    expect(new Set(seen).size).toBe(120);
  });

  it("finds paths and trace ids by substring", async () => {
    const app = await buildTestApp();
    const cookie = await login(app);
    const service = await seedLogs(1, "GET /api/users/42 -> 200");

    const res = await request(app.getHttpServer())
      .get(`/api/logs?${WIDE}&service=${service}&q=${encodeURIComponent("/api/users/42")}`)
      .set("Cookie", cookie)
      .expect(200);

    // The search FULLTEXT could not have done — its tokenizer shreds paths.
    expect(res.body.rows).toHaveLength(1);
  });

  it("escapes LIKE metacharacters in the search term", async () => {
    const app = await buildTestApp();
    const cookie = await login(app);
    const service = await seedLogs(1, "cache hit rate 100% today");

    const res = await request(app.getHttpServer())
      .get(`/api/logs?${WIDE}&service=${service}&q=${encodeURIComponent("100%")}`)
      .set("Cookie", cookie)
      .expect(200);

    expect(res.body.rows).toHaveLength(1);
  });

  it("returns the id as a string", async () => {
    const app = await buildTestApp();
    const cookie = await login(app);
    const service = await seedLogs(1);

    const res = await request(app.getHttpServer())
      .get(`/api/logs?${WIDE}&service=${service}`)
      .set("Cookie", cookie)
      .expect(200);

    expect(typeof res.body.rows[0].id).toBe("string");
  });
});
```

Extend `apps/api/test/helpers.ts` with `login(app)` returning the cookie header and `seedLogs(n, message?)` inserting rows under a fresh random service name via `persistBatch`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run apps/api/src/logs apps/api/test/logs`
Expected: FAIL — `/api/logs` 404s.

- [ ] **Step 3: Implement the cursor**

`apps/api/src/logs/cursor.ts`:

```ts
export function encodeCursor(ts: Date, id: bigint): string {
  return Buffer.from(`${ts.getTime()}:${id}`).toString("base64url");
}

export function decodeCursor(raw: string): { ts: Date; id: bigint } | null {
  try {
    const [ms, id] = Buffer.from(raw, "base64url").toString("utf8").split(":");
    if (!ms || !id) return null;
    return { ts: new Date(Number(ms)), id: BigInt(id) };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Implement the query**

`apps/api/src/logs/logs.service.ts` — raw SQL, because optional filters and a composite cursor comparison do not express cleanly through the Prisma API:

```ts
import { Prisma, prisma } from "@iknos/db";

export type LogQuery = {
  from: Date; to: Date;
  service?: string; minLevel?: number; route?: string; statusCode?: number;
  q?: string;
  after?: { ts: Date; id: bigint };
  limit: number;
};

export async function search(query: LogQuery) {
  const where: Prisma.Sql[] = [
    Prisma.sql`ts >= ${query.from}`,
    Prisma.sql`ts < ${query.to}`,
  ];

  if (query.service) where.push(Prisma.sql`service = ${query.service}`);
  if (query.minLevel !== undefined) where.push(Prisma.sql`level >= ${query.minLevel}`);
  if (query.route) where.push(Prisma.sql`route = ${query.route}`);
  if (query.statusCode !== undefined) where.push(Prisma.sql`status_code = ${query.statusCode}`);

  if (query.q) {
    // Escape LIKE metacharacters so someone searching for "100%" gets what
    // they asked for rather than everything.
    const escaped = query.q.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
    where.push(Prisma.sql`message LIKE ${`%${escaped}%`}`);
  }

  if (query.after) {
    // Row-value comparison keeps the keyset ordering correct across rows that
    // share a millisecond.
    where.push(Prisma.sql`(ts, id) < (${query.after.ts}, ${query.after.id})`);
  }

  return prisma.$queryRaw<
    Array<{
      id: bigint; ts: Date; service: string; level: number; levelName: string;
      message: string; traceId: string | null; route: string | null;
      statusCode: number | null; durationMs: number | null;
    }>
  >`
    SELECT id, ts, service, level, level_name AS levelName, message,
           trace_id AS traceId, route, status_code AS statusCode,
           duration_ms AS durationMs
    FROM log_entry
    WHERE ${Prisma.join(where, " AND ")}
    ORDER BY ts DESC, id DESC
    LIMIT ${query.limit}
  `;
}
```

- [ ] **Step 5: Implement the controller**

`apps/api/src/logs/logs.controller.ts`:

```ts
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 100;

@Controller("api/logs")
export class LogsController {
  @Get()
  async list(@Query() p: LogQueryDto): Promise<LogPage> {
    // Enforced, never defaulted: a forgotten range must be a loud 400, not a
    // silent full scan.
    if (!p.from || !p.to) {
      throw new BadRequestException("both 'from' and 'to' are required");
    }
    const from = new Date(p.from);
    const to = new Date(p.to);
    if (Number.isNaN(+from) || Number.isNaN(+to)) {
      throw new BadRequestException("'from' and 'to' must be ISO timestamps");
    }
    if (to <= from) throw new BadRequestException("'to' must be after 'from'");

    const limit = Math.min(Math.max(p.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

    // Fetch one extra to learn whether another page exists, without a COUNT.
    const found = await search({
      from, to,
      service: p.service, minLevel: p.min_level, route: p.route, statusCode: p.status,
      q: p.q?.trim() || undefined,
      after: p.cursor ? (decodeCursor(p.cursor) ?? undefined) : undefined,
      limit: limit + 1,
    });

    const hasMore = found.length > limit;
    const page = found.slice(0, limit);
    const last = page.at(-1);

    return {
      // id is a BigInt beyond Number.MAX_SAFE_INTEGER; it crosses as a string
      // or JSON.stringify throws and pagination silently skips rows.
      rows: page.map((r) => ({ ...r, id: r.id.toString(), ts: r.ts.toISOString() })),
      nextCursor: hasMore && last ? encodeCursor(last.ts, last.id) : null,
    };
  }
}
```

Add `GET /api/services` as a plain `prisma.service.findMany({ where: { enabled: true } })`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run apps/api/src/logs apps/api/test/logs`
Expected: PASS — 2 cursor tests, 5 endpoint tests.

- [ ] **Step 7: Confirm partition pruning actually happens**

Run:

```bash
mysql iknos -e "EXPLAIN SELECT id FROM log_entry WHERE ts >= '2026-08-09 00:00:00' AND ts < '2026-08-10 00:00:00'\G" | grep -i partitions
```

Expected: a single named partition. If every partition is listed, the range predicate is not pruning and that must be fixed before this ships — the whole schema rests on it.

- [ ] **Step 8: Commit**

```bash
git add apps/api packages/contracts
git commit -m "feat(api): logs search with keyset pagination"
```

---

## Task 17: Live tail over SSE

**Files:**
- Create: `apps/api/src/stream/stream.controller.ts`, `apps/api/test/stream.e2e-spec.ts`

**Interfaces:**
- Produces: `GET /api/logs/stream`, emitting `log` events whose payload is a `LogRow` — the same shape `GET /api/logs` returns, so the front end needs one row renderer.

- [ ] **Step 1: Write the failing test**

`apps/api/test/stream.e2e-spec.ts`:

```ts
import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildTestApp, login } from "./helpers";

const WIDE = "from=2020-01-01T00:00:00Z&to=2100-01-01T00:00:00Z";

describe("GET /api/logs/stream", () => {
  it("requires a session", async () => {
    const app = await buildTestApp();
    // SSE must not be a back door around the guard.
    await request(app.getHttpServer()).get(`/api/logs/stream?${WIDE}`).expect(401);
  });

  it("requires a time range", async () => {
    const app = await buildTestApp();
    const cookie = await login(app);
    await request(app.getHttpServer()).get("/api/logs/stream").set("Cookie", cookie).expect(400);
  });

  it("unsubscribes from the bus when the client disconnects", async () => {
    const app = await buildTestApp();
    const bus = app.get(LogBus);
    const before = bus.listenerCount();

    const req = request(app.getHttpServer())
      .get(`/api/logs/stream?${WIDE}`)
      .set("Cookie", await login(app));
    req.end(() => {});
    await new Promise((r) => setTimeout(r, 300));
    req.abort();
    await new Promise((r) => setTimeout(r, 300));

    // Listeners accumulating on dead requests is the classic SSE leak.
    expect(bus.listenerCount()).toBe(before);
  });
});
```

Add a `listenerCount()` accessor to `LogBus` for this test.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/api/test/stream`
Expected: FAIL — 404.

- [ ] **Step 3: Implement it**

Written against the raw response rather than Nest's `@Sse()` decorator. `@Sse()` is tidier, but it gives no access to the socket's buffered length — and without that the "a slow subscriber must not retain memory" requirement cannot actually be met, only hoped for.

`apps/api/src/stream/stream.controller.ts`:

```ts
import { BadRequestException, Controller, Get, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import type { LogRecord } from "@iknos/contracts";
import { LogBus } from "./log-bus";

/** Once this much unflushed data is queued for one client, it is not keeping
 *  up. Drop rather than buffer: an unread background tab must never retain
 *  memory or exert backpressure on ingestion. */
const MAX_PENDING_BYTES = 256 * 1024;
const HEARTBEAT_MS = 15_000;

@Controller("api/logs")
export class StreamController {
  constructor(private readonly bus: LogBus) {}

  @Get("stream")
  stream(@Query() p: StreamQueryDto, @Req() req: Request, @Res() res: Response): void {
    // Same rule as the search endpoint, so the UI can share one query builder.
    if (!p.from || !p.to) throw new BadRequestException("both 'from' and 'to' are required");

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Belt and braces with nginx's proxy_buffering off (Task 23).
      "X-Accel-Buffering": "no",
    });

    let dropped = 0;

    const matches = (r: LogRecord) =>
      (!p.service || r.service === p.service) &&
      (p.min_level === undefined || r.level >= p.min_level) &&
      (!p.q || r.message.includes(p.q));

    const unsubscribe = this.bus.subscribe((record) => {
      if (!matches(record)) return;

      if (res.writableLength > MAX_PENDING_BYTES) {
        dropped++;
        return;
      }
      if (dropped > 0) {
        // Tell the client it has a hole, so the UI can show a gap marker
        // instead of quietly lying about continuity.
        res.write(`event: lagged\ndata: ${dropped}\n\n`);
        dropped = 0;
      }

      const row = {
        // Live rows have no database id yet; the client keys on ts + message.
        id: "", ts: record.ts.toISOString(), service: record.service,
        level: record.level, levelName: record.levelName, message: record.message,
        traceId: record.traceId, route: record.route,
        statusCode: record.statusCode, durationMs: record.durationMs,
      };
      res.write(`event: log\ndata: ${JSON.stringify(row)}\n\n`);
    });

    // Keeps nginx's read timeout from closing an idle stream.
    const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);

    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/api/test/stream`
Expected: PASS, 3 tests.

- [ ] **Step 5: Verify a slow consumer cannot stall ingestion**

With the server up and a session cookie in `$C`:

```bash
curl -sN -H "Cookie: $C" "localhost:4310/api/logs/stream?from=2020-01-01T00:00:00Z&to=2100-01-01T00:00:00Z" > /dev/null &
for i in $(seq 1 20000); do echo "{\"@timestamp\":\"2026-08-09T10:00:00.000Z\",\"log.level\":\"info\",\"message\":\"burst $i\"}"; done >> /tmp/iknos-demo-out.log
sleep 15 && mysql iknos -e "SELECT COUNT(*) FROM log_entry WHERE message LIKE 'burst %'"
```

Expected: the count reaches 20000. `lagged` events on the subscriber are the design working, not a fault.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): live tail over server-sent events"
```

---

## Task 18: Partition maintenance and retention

**Files:**
- Create: `apps/api/src/maintenance/partitions.ts`, `apps/api/src/maintenance/partitions.spec.ts`, `apps/api/src/maintenance/maintenance.service.ts`, `apps/api/test/maintenance.e2e-spec.ts`

**Interfaces:**
- Produces: `plan(existing: string[], today: Date, retentionDays: number, daysAhead: number): Plan` (pure) and `MaintenanceService` running it at boot and daily.

The planning is pure so the date arithmetic — the part that is genuinely easy to get wrong — is tested without a database.

- [ ] **Step 1: Write the failing test**

`apps/api/src/maintenance/partitions.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { plan } from "./partitions";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("plan", () => {
  it("creates the window ahead when none exists", () => {
    const p = plan([], d("2026-08-09"), 14, 3);
    expect(p.toCreate).toEqual(["p20260809", "p20260810", "p20260811"]);
    expect(p.toDrop).toEqual([]);
  });

  it("only creates what is missing", () => {
    const p = plan(["p20260809", "p20260810"], d("2026-08-09"), 14, 3);
    expect(p.toCreate).toEqual(["p20260811"]);
  });

  it("drops partitions past the retention window", () => {
    const existing = ["p20260725", "p20260726", "p20260727", "p20260809"];
    const p = plan(existing, d("2026-08-09"), 14, 3);
    expect(p.toDrop).toEqual(["p20260725", "p20260726"]);
  });

  it("never drops the future partition", () => {
    const p = plan(["p_future", "p20260101"], d("2026-08-09"), 14, 3);
    expect(p.toDrop).toEqual(["p20260101"]);
  });

  it("leaves unrecognised names alone", () => {
    const p = plan(["p_future", "something_else"], d("2026-08-09"), 14, 3);
    expect(p.toDrop).toEqual([]);
  });

  it("catches up after a long outage without creating the past", () => {
    const p = plan([], d("2026-09-09"), 14, 3);
    expect(p.toCreate).toEqual(["p20260909", "p20260910", "p20260911"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/api/src/maintenance`
Expected: FAIL — cannot resolve `./partitions`.

- [ ] **Step 3: Implement planning**

`apps/api/src/maintenance/partitions.ts`:

```ts
export const FUTURE_PARTITION = "p_future";

export type Plan = { toCreate: string[]; toDrop: string[] };

const DAY_MS = 24 * 60 * 60 * 1000;

export function partitionName(date: Date): string {
  return `p${date.toISOString().slice(0, 10).replace(/-/g, "")}`;
}

export function dateOf(name: string): Date | null {
  const m = /^p(\d{4})(\d{2})(\d{2})$/.exec(name);
  if (!m) return null;
  const date = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function plan(
  existing: string[],
  today: Date,
  retentionDays: number,
  daysAhead: number,
): Plan {
  const toCreate: string[] = [];
  for (let i = 0; i < daysAhead; i++) {
    const name = partitionName(new Date(today.getTime() + i * DAY_MS));
    if (!existing.includes(name)) toCreate.push(name);
  }

  const cutoff = today.getTime() - retentionDays * DAY_MS;
  const toDrop = existing.filter((name) => {
    if (name === FUTURE_PARTITION) return false;
    const date = dateOf(name);
    // An unrecognised name yields null and is therefore never dropped.
    return date !== null && date.getTime() <= cutoff;
  });

  return { toCreate, toDrop };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/api/src/maintenance`
Expected: PASS, 6 tests.

- [ ] **Step 5: Implement the scheduled job**

`apps/api/src/maintenance/maintenance.service.ts`, using `@nestjs/schedule`:

```ts
@Injectable()
export class MaintenanceService implements OnApplicationBootstrap {
  // Once at boot so a fresh deploy is immediately correct...
  async onApplicationBootstrap() { await this.run(); }

  // ...then daily.
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async run(): Promise<void> {
    const rows = await prisma.$queryRaw<Array<{ PARTITION_NAME: string }>>`
      SELECT PARTITION_NAME FROM information_schema.PARTITIONS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'log_entry'
        AND PARTITION_NAME IS NOT NULL
    `;

    const { toCreate, toDrop } = plan(
      rows.map((r) => r.PARTITION_NAME),
      new Date(),
      this.config.retentionDays,
      3,
    );

    // DDL cannot be parameterised, hence $executeRawUnsafe. Every name here is
    // generated from a Date or matched against /^p\d{8}$/ — never from user
    // input. That constraint is what makes this safe, and it is not optional.
    for (const name of toCreate) {
      const boundary = new Date(dateOf(name)!.getTime() + 86_400_000)
        .toISOString().slice(0, 10);
      await prisma.$executeRawUnsafe(
        `ALTER TABLE log_entry REORGANIZE PARTITION ${FUTURE_PARTITION} INTO (` +
        `PARTITION ${name} VALUES LESS THAN (TO_DAYS('${boundary}')), ` +
        `PARTITION ${FUTURE_PARTITION} VALUES LESS THAN MAXVALUE)`,
      );
    }

    for (const name of toDrop) {
      // Instant, and it returns the space to the filesystem — what a batched
      // DELETE could never do.
      await prisma.$executeRawUnsafe(`ALTER TABLE log_entry DROP PARTITION ${name}`);
    }

    logger.info({ created: toCreate.length, dropped: toDrop.length }, "partition maintenance");
  }
}
```

- [ ] **Step 6: Write the integration test**

`apps/api/test/maintenance.e2e-spec.ts` — run the job twice, assert the second is a no-op, then insert a row for today and assert it still succeeds. Re-running must never duplicate a partition or leave the table unwritable.

- [ ] **Step 7: Verify the disk claim rather than trusting it**

```bash
mysql iknos -e "SELECT PARTITION_NAME, TABLE_ROWS, DATA_LENGTH FROM information_schema.PARTITIONS WHERE TABLE_NAME='log_entry'"
```

Expected: one row per day plus `p_future`, and sizes that go to nothing after a drop.

- [ ] **Step 8: Commit**

```bash
git add apps/api
git commit -m "feat(maintenance): daily partition window and retention"
```

---

## Task 19: Next app and design system port

**Files:**
- Create: `apps/web/` (Next App Router), `apps/web/src/app/layout.tsx`, `apps/web/src/styles/*`, `apps/web/src/lib/api.ts`, `apps/web/src/components/*`

**Interfaces:**
- Produces: `apiGet<T>(path)` for server components (forwards the incoming cookie) and `apiMutate(path, body)` for client components (attaches the CSRF header). Tasks 20, 21 and 22 use only these two.

- [ ] **Step 1: Scaffold**

```bash
pnpm create next-app@latest apps/web --ts --app --tailwind --eslint=false --src-dir --import-alias '@/*'
```

Delete the generated boilerplate page and CSS so nothing from the template survives the port.

- [ ] **Step 2: Port the design system from PFA**

Copy into `apps/web/src/styles/`: the `globals.css` split, the token files (colours, spacing, radii, typography, scales), the font setup, and the background and grain layers. Then rename in one pass:

```bash
cd apps/web && grep -rl 'pfa-' src | xargs sed -i '' 's/pfa-/ikn-/g' && grep -rn 'pfa-' src | wc -l
```

Expected: `0`. Drop the `''` after `-i` on Linux.

A fork, not a link: from here the two design systems evolve separately.

- [ ] **Step 3: Port only what M1 needs**

`GlowCard` with its gradient and border rule, buttons, text fields, selects, the table primitive, the status badge, tooltip, and the time-range picker with its `nuqs` URL state.

**Not** the dataviz primitives — M1 has no charts and they would be dead code. They arrive with `IKN-13`.

Keep the original rules: no arbitrary Tailwind values, everything snapped to tokens.

- [ ] **Step 4: Write the API client**

`apps/web/src/lib/api.ts`:

```ts
const API_BASE = process.env.IKNOS_API_BASE ?? "http://127.0.0.1:4310";

/** Server components only: forwards the caller's session cookie to Nest. */
export async function apiGet<T>(path: string): Promise<T> {
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  const header = jar.getAll().map((c) => `${c.name}=${c.value}`).join("; ");

  const res = await fetch(`${API_BASE}${path}`, {
    headers: { cookie: header },
    cache: "no-store", // log data is never stale-cacheable
  });

  if (res.status === 401) {
    const { redirect } = await import("next/navigation");
    redirect("/login");
  }
  if (!res.ok) throw new Error(`api ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

/** Client components: same origin, so the browser sends the cookie itself. */
export async function apiMutate(path: string, body?: unknown): Promise<Response> {
  const { csrfToken } = await fetch("/api/csrf", { credentials: "same-origin" })
    .then((r) => r.json());

  return fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
```

Client-side calls use relative paths so they reach nginx on the same origin — which is what makes the cookie and CSRF header work with no CORS configuration at all.

- [ ] **Step 5: Add the app chrome**

`layout.tsx` with the four nav entries (Overview, Logs, Issues, Alerts). Only Logs is reachable in M1; the other three render a "coming in M2" state rather than a dead link, so the navigation never has to change shape.

- [ ] **Step 6: Verify**

Run: `pnpm --filter web build`
Expected: build succeeds, no `pfa-` remaining, types resolve against `@iknos/contracts`.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): next app with the PFA design system ported"
```

---

## Task 20: Login page and route protection

**Files:**
- Create: `apps/web/src/app/login/page.tsx`, `apps/web/src/app/login/login-form.tsx`, `apps/web/src/middleware.ts`

**Interfaces:**
- Produces: a working login flow. Every later page can assume a session exists by the time it renders.

- [ ] **Step 1: Write the middleware**

`apps/web/src/middleware.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";

// Next middleware runs on the Edge runtime, where no Redis client works. So it
// checks only that a cookie is PRESENT and redirects otherwise. Whether the
// session is valid is decided by Nest on every single call — this is a UX
// shortcut, not a security boundary. Do not "finish" it by validating here.
export function middleware(req: NextRequest) {
  if (req.cookies.has("iknos.sid")) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 2: Write the form**

`login-form.tsx` — a client component posting to `/api/auth/login` with `credentials: "same-origin"`. Login carries no CSRF token, because there is no session yet to mint one from; `SameSite=Lax` is what protects it.

Three states, exactly:

```tsx
if (res.status === 429) {
  setError("Trop de tentatives. Réessayez dans une minute.");
} else if (!res.ok) {
  // Deliberately identical for unknown account and wrong password.
  setError("Identifiants invalides.");
} else {
  router.replace("/logs");
}
```

- [ ] **Step 3: Verify by hand**

Submit empty (client validation blocks), wrong credentials (generic message), six times fast (the 429 message), correct credentials (redirect to `/logs`).

Cookie flags are checked in Task 23 against the deployed environment — `Secure` requires HTTPS and cannot be observed on `localhost`.

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat(web): login page and cookie-presence middleware"
```

---

## Task 21: Logs page — search, filters and pagination

**Files:**
- Create: `apps/web/src/lib/log-query.ts`, `apps/web/src/lib/log-query.test.ts`, `apps/web/src/app/logs/page.tsx`, `apps/web/src/app/logs/filters.tsx`, `apps/web/src/app/logs/log-table.tsx`, `apps/web/src/app/logs/log-row.tsx`

**Interfaces:**
- Produces: `buildLogQuery(params: URLSearchParams, now?: Date): string` — the single place UI state becomes an API query. Task 22 reuses it for the SSE URL, so search and live tail cannot drift apart.

- [ ] **Step 1: Write the query builder with its test**

`apps/web/src/lib/log-query.ts`:

```ts
export type Range = "15m" | "1h" | "24h" | "7d";

const MINUTES: Record<Range, number> = { "15m": 15, "1h": 60, "24h": 1440, "7d": 10080 };

export function resolveRange(range: Range, now = new Date()) {
  return {
    from: new Date(now.getTime() - MINUTES[range] * 60_000).toISOString(),
    to: now.toISOString(),
  };
}

/**
 * `from` and `to` are always present. The API rejects a request without them,
 * so the UI must be structurally incapable of building one.
 */
export function buildLogQuery(params: URLSearchParams, now = new Date()): string {
  const range = (params.get("range") as Range | null) ?? "1h";
  const { from, to } = resolveRange(MINUTES[range] ? range : "1h", now);

  const out = new URLSearchParams({ from, to });
  for (const key of ["service", "min_level", "route", "status", "q", "cursor"]) {
    const value = params.get(key);
    if (value) out.set(key, value);
  }
  return out.toString();
}
```

`apps/web/src/lib/log-query.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildLogQuery } from "./log-query";

describe("buildLogQuery", () => {
  it("always emits from and to", () => {
    const q = new URLSearchParams(buildLogQuery(new URLSearchParams()));
    expect(q.get("from")).toBeTruthy();
    expect(q.get("to")).toBeTruthy();
  });

  it("passes through set filters and omits unset ones", () => {
    const q = new URLSearchParams(
      buildLogQuery(new URLSearchParams({ service: "pfa-api", q: "/api/users/42" })),
    );
    expect(q.get("service")).toBe("pfa-api");
    expect(q.get("q")).toBe("/api/users/42");
    expect(q.has("route")).toBe(false);
  });

  it("honours the selected range", () => {
    const now = new Date("2026-08-09T12:00:00.000Z");
    const q = new URLSearchParams(buildLogQuery(new URLSearchParams({ range: "24h" }), now));
    expect(q.get("from")).toBe("2026-08-08T12:00:00.000Z");
  });

  it("falls back to a sane range rather than emitting an invalid one", () => {
    const q = new URLSearchParams(buildLogQuery(new URLSearchParams({ range: "nonsense" })));
    expect(q.get("from")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails, then passes**

Run: `pnpm --filter web vitest run src/lib/log-query.test.ts`
Expected: FAIL first (module not found), PASS once Step 1's file is saved.

- [ ] **Step 3: Build the page**

`page.tsx` — a server component reading `searchParams`, calling ``apiGet<LogPage>(`/api/logs?${buildLogQuery(params)}`)``, rendering `<Filters />` and `<LogTable />`. `LogPage` and `LogRow` come from `@iknos/contracts`, never hand-redeclared.

`filters.tsx` — a client component holding service, minimum level, route, status, free text and range, all state in the URL via `nuqs`. A shareable, reloadable search falls out of that for free.

`log-table.tsx` — dense rows: timestamp, service, level badge, message. Clicking a row expands the full record including `attrs`. Clicking a `traceId` sets `q` to that id and clears the other filters — the move that turns one line into the whole request.

- [ ] **Step 4: Wire up pagination**

Load-more, not numbered pages: `nextCursor` from the previous response goes into the next request, and rows append rather than replace.

Because the cursor is keyset rather than an offset, rows arriving during paging cannot shift the window and cause a duplicate or a skip.

- [ ] **Step 5: Verify**

With ingestion running: every filter combines and survives a reload; a `traceId` click reconstructs the request; load-more reaches the end with no repeated row; 10 000 loaded rows still scroll smoothly.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): logs page with filters and cursor pagination"
```

---

## Task 22: Logs page — live tail

**Files:**
- Create: `apps/web/src/app/logs/live-tail.tsx`, `apps/web/src/hooks/use-log-stream.ts`

**Interfaces:**
- Produces: `useLogStream(query: string, enabled: boolean)` returning `{ rows, gaps, connected, paused }`.

- [ ] **Step 1: Write the hook**

`apps/web/src/hooks/use-log-stream.ts`:

```ts
"use client";

import { useEffect, useRef, useState } from "react";
import type { LogRow } from "@iknos/contracts";

/** A tab left open overnight must not accumulate a gigabyte of rows. */
const MAX_BUFFERED_ROWS = 2000;

export function useLogStream(query: string, enabled: boolean) {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [gaps, setGaps] = useState(0);
  const [connected, setConnected] = useState(false);
  const paused = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      return;
    }

    const source = new EventSource(`/api/logs/stream?${query}`);
    source.onopen = () => setConnected(true);

    source.addEventListener("log", (e) => {
      if (paused.current) return;
      const row = JSON.parse((e as MessageEvent).data) as LogRow;
      setRows((prev) => [row, ...prev].slice(0, MAX_BUFFERED_ROWS));
    });

    // The server sends this when this subscriber fell behind and rows were
    // dropped for it. Surfacing it is honest; hiding it makes the list silently
    // wrong.
    source.addEventListener("lagged", () => setGaps((g) => g + 1));

    // EventSource reconnects on its own; we only reflect the state.
    source.onerror = () => setConnected(false);

    return () => {
      source.close();
      setConnected(false);
    };
  }, [query, enabled]);

  return { rows, gaps, connected, paused };
}
```

- [ ] **Step 2: Build the component**

`live-tail.tsx` — a client component with a start/stop toggle, building its query with the same `buildLogQuery` the search page uses so the two views cannot diverge.

Pause on scroll: when the user leaves the top of the list, set `paused.current = true` and show a "N nouvelles lignes" button that resumes and jumps back. A list that jumps while you are reading it is unusable, and this is the whole difference between a live tail people use and one they switch off.

Render a visible marker whenever `gaps` increases, and a connection indicator driven by `connected`.

- [ ] **Step 3: Verify the hard cases**

- A line appended to a PM2 log file appears within 2 seconds.
- Scrolling down pauses; the resume button restores the flow.
- Restarting the Nest process shows a disconnect, then reconnects on its own with a gap marker.
- Leave the tab open 8 hours under real traffic; browser memory stays flat. If it climbs, `MAX_BUFFERED_ROWS` is not being applied.

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat(web): live tail with pause-on-scroll and gap markers"
```

---

## Task 23: Deployment

**Files:**
- Create: `deploy/ecosystem.config.js`, `deploy/nginx.conf`, `deploy/deploy.sh`, `README.md`

**Interfaces:**
- Produces: a deployed Iknos on its subdomain, and a one-command deploy.

Both processes are Node, so this is a copy-and-adapt of PFA's deployment. Build on ks-b, same release-directory scheme, no second machine.

- [ ] **Step 1: Write the PM2 ecosystem file**

`deploy/ecosystem.config.js`:

```js
module.exports = {
  apps: [
    {
      name: "iknos-api",
      script: "dist/main.js",
      cwd: "/var/www/iknos/current/apps/api",
      env_file: "/var/www/iknos/shared/.env",
      // The Nest side drains on SIGTERM; give it room before SIGKILL.
      kill_timeout: 10000,
      max_restarts: 10,
    },
    {
      name: "iknos-web",
      script: "pnpm",
      args: "start",
      cwd: "/var/www/iknos/current/apps/web",
      env: { PORT: "4311", IKNOS_API_BASE: "http://127.0.0.1:4310" },
    },
  ],
};
```

- [ ] **Step 2: Write the nginx site**

`deploy/nginx.conf`:

```nginx
server {
  listen 443 ssl http2;
  server_name iknos.YOUR_DOMAIN;

  # TLS via certbot

  location /health {
    proxy_pass http://127.0.0.1:4310;
  }

  # SSE needs its own block, before the general /api/ one.
  location /api/logs/stream {
    proxy_pass http://127.0.0.1:4310;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    # Without this nginx buffers the stream and "live" arrives in clumps every
    # few seconds. This is the line everyone forgets.
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }

  location /api/ {
    proxy_pass http://127.0.0.1:4310;
    proxy_set_header Host $host;
    # The login rate limiter keys on this. Without it every request appears to
    # come from 127.0.0.1 and the first five failures lock out everybody.
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Real-IP $remote_addr;
  }

  location / {
    proxy_pass http://127.0.0.1:4311;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

One subdomain, so the browser stays on one origin and the session cookie and CSRF header work with no CORS configuration.

- [ ] **Step 3: Write the deploy script**

`deploy/deploy.sh` — pull, `pnpm install --frozen-lockfile`, `pnpm -r build`, symlink the new release to `current`, `pm2 reload` both processes. Model it on PFA's script.

**The script never migrates.** Migrations are manual:

```bash
ssh ks-b 'cd /var/www/iknos/current && pnpm prisma migrate deploy'
```

- [ ] **Step 4: First deploy**

```bash
ssh ks-b 'mkdir -p /var/www/iknos/shared && chmod 700 /var/www/iknos/shared'
# Write /var/www/iknos/shared/.env with the real secrets, then:
ssh ks-b 'chmod 600 /var/www/iknos/shared/.env'
./deploy/deploy.sh
ssh ks-b 'cd /var/www/iknos/current && pnpm prisma migrate deploy && pnpm seed:user you@yourdomain'
ssh ks-b 'pm2 start deploy/ecosystem.config.js && pm2 save && pm2 startup'
```

- [ ] **Step 5: Verify against the milestone's criteria**

```bash
curl -si https://iknos.YOUR_DOMAIN/api/me | head -1   # expect 401
curl -si https://iknos.YOUR_DOMAIN/health  | head -1   # expect 200
```

Then in a browser: log in, confirm in devtools that the cookie carries `HttpOnly`, `Secure` and `SameSite=Lax` (only observable over real HTTPS), open the Logs page, and confirm a line written by any PM2 app on ks-b appears within 2 seconds.

Reboot the machine and confirm both processes return. Rollback to the previous release once, deliberately, so you know it works before you need it.

- [ ] **Step 6: Write the README**

Installation, environment variables, local commands, deploy and rollback, the manual migration step, the measured RSS of both processes after 24 hours, and the measured steady-state database size.

- [ ] **Step 7: Commit**

```bash
git add deploy/ README.md
git commit -m "feat(deploy): pm2, nginx and release-directory deployment"
```

---

## Self-Review

**Spec coverage.** Every section of the design doc maps to a task: §3 architecture → Tasks 1, 7, 15; §4 data model → Tasks 2, 3, 18; §5 ingestion → Tasks 11–15; §6 API and auth → Tasks 4–10, 16, 17; §7 the Next seam → Tasks 19, 21; §8 deployment → Task 23; §9 testing → distributed through every task rather than gathered at the end.

**The three places Node needs discipline Rust gave for free** — all three are acceptance criteria, not commentary:
- Task 11, decoding only complete lines. Without it, a split codepoint becomes U+FFFD silently.
- Task 14, the queue ceiling checked by hand on every push. Node has no bounded channel.
- Tasks 15 and 17, unsubscribing on disconnect and never overlapping polls. Neither is enforced by anything but the code.

**Deliberate deferrals**, noted rather than dropped: the dataviz primitives from `IKN-5` are not ported in Task 19 (M1 has no charts; they arrive with `IKN-13`), and `apps/web` is scaffolded as a placeholder in Task 1 before being built properly in Task 19.

**Values to fill in from your environment**, each called out at the step that needs it: the real `DUMMY_HASH` bcrypt string in Task 10, and `YOUR_DOMAIN` in Task 23. Both are environment facts, not undecided design.

**Ordering note.** Task 10's first test asserts 401 on `/api/services` and `/api/logs`, which do not exist until Task 16. Nest returns 404 for an unmounted route, so either run that test after Task 16 or assert "not 200" until then.
