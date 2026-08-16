# Iknos M1 — Logs End to End (NestJS): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a deployed Iknos that tails every PM2 log file on ks-b into MySQL and serves it back through an authenticated, keyboard-driven Logs view with search, filters, a volume histogram, live tail and request timelines.

**Architecture:** One NestJS app (`iknos-api`) hosts the collector and the HTTP API in a single process, talking to MySQL through Prisma and Redis for sessions. A Next app holds no database access — its server components fetch the API over localhost, forwarding the session cookie. nginx routes `/api/*` to Nest and everything else to Next on one subdomain. The UI is service-scoped: a PM2 service rail drives every view, and the chassis around it ships whole in M1 even though most of its views arrive later.

**Tech Stack:** NestJS, Prisma 7 + `@prisma/adapter-mariadb`, MySQL 8 with daily partitioning, Redis, pino + `@elastic/ecs-pino-format`, Next App Router, Tailwind v4, nuqs, PM2, nginx.

**Specs:** `docs/superpowers/specs/2026-08-10-iknos-nestjs-api-design.md` (backend) and `docs/superpowers/specs/2026-08-09-iknos-ui-design.md` (UI, tokens and interaction). The mockup those come from is `docs/design/iknos-prototype.dc.html`.

## Global Constraints

- `pnpm check` and `pnpm test` must pass before every commit. Biome config copied from PFA, `lineWidth: 120`.
- Path aliases everywhere, never relative imports across directories.
- `ingest` and `logs` modules may both depend on `PrismaService` and on the event bus, **never on each other**.
- Migrations are applied by hand over SSH. **No task ever runs a migration from a deploy script.**
- DB column names: `byte_offset` not `offset` (`OFFSET` is reserved in MySQL 8.0); the users table is `app_user` not `user`.
- Every route except `GET /health` and `POST /api/auth/login` requires a valid session, enforced by a global `APP_GUARD`, never per-controller.
- Error responses never contain internal detail (SQL text, file paths, hostnames). Detail goes to logs only.
- `GET /api/logs`, `GET /api/logs/stream` and `GET /api/logs/histogram` reject any request without both `from` and `to`.
- Nothing in the ingestion path may block the event loop: no sync file I/O, no `JSON.parse` on an unbounded line, no backtracking regex over log text.
- **UI: no colour outside the token layer**, and no arbitrary Tailwind values (`text-[…]`, `gap-[…]`). Brackets are for structure only. Every state has a dark token and a light token — the component picks by surface (UI spec §3.2).
- **UI: the page never scrolls.** 1440×900 is the design frame; only lists scroll inside their own box.
- **UI: a view whose data does not exist yet is absent, not faked.** No placeholder charts, no lorem numbers, no greyed-out "coming soon" entries.
- Every list response carries `meta.tookMs`, and the status bar shows it.
- Commits use the repo's configured git identity, with no co-author or tool attribution trailers.

## File Structure

The layout is the fleet's, not a new one: `front/` beside `nest-api/`, Prisma inside the API,
each a standalone project with its own `package.json` and its own `node_modules`. Identical to
Zeus, PFA, spira and trekker. There is no root workspace and no shared package — the front
**restates** the response types rather than importing them, which is the choice trekker made
explicitly and the reason no `contracts` package exists here.

```
iknos/
  biome.json                       root config, lineWidth 120
  nest-api/
    prisma/
      schema.prisma
      seed.ts                      service registry
    prisma.config.ts               CLI only; the app connects through PrismaService
    generated/prisma/              generated client, gitignored
    scripts/create-account.ts      the account CLI
    src/
      main.ts                      bootstrap, shutdown hooks
      app.module.ts
      prisma/
        prisma.service.ts          the one client, injectable
        prisma.module.ts           @Global
      config/env.ts                schema + validated Config type
      common/
        all-exceptions.filter.ts
        logger.ts                  pino ECS + INGEST_SKIP_MARKER
      redis/
        redis.service.ts           the one client + clearSessionsForUser
        redis.module.ts            @Global
      types/
        express-session.d.ts       what a session holds
      auth/
        session.constants.ts       cookie name, 2h TTL
        session.middleware.ts      express-session + connect-redis
        csrf.util.ts               constant-time compare
        session.guard.ts           APP_GUARD + @Public()
        auth.controller.ts         login, logout, csrf, me
        account.controller.ts      register, recover, password
        ratelimit.service.ts
      logs/
        logs.controller.ts
        logs.service.ts            raw SQL query builder
        histogram.service.ts       bucketed counts by level
        trace.service.ts           rows sharing a trace.id
        cursor.ts                  encode/decode keyset cursor
        log-page.ts                response shape
      search/
        search.controller.ts       one route, several sources
      collector/
        collector.controller.ts    status and storage
        storage.service.ts         information_schema, cached
      stream/
        log-bus.ts                 in-process event bus
        stream.controller.ts       manual SSE
      ingest/
        line-buffer.ts             byte framing
        parser.ts                  ECS / bare JSON / plain text
        log-record.ts              the parsed shape
        tailer.ts                  stat loop, rotation
        writer.ts                  bounded queue, transactional batch
        ingest-stats.ts            counters read by /api/collector/status
        ingest.service.ts          lifecycle wiring
      maintenance/
        partitions.ts              pure planning
        maintenance.service.ts     scheduled job
  front/src/
    styles/                        globals split + Iknos token layer
    lib/
      api.ts                       apiGet / apiMutate
      log-query.ts                 UI state -> API query, one place
      types/                       response shapes, restated from nest-api
    components/
      chrome/                      top bar, service rail, status bar
      ui/                          card, button, field, chip, table, modal, toast
    hooks/
      use-shortcuts.ts             global key map, mounted once
      use-log-stream.ts            EventSource + bounded buffer
    app/
      (auth)/                      login, register, recover, about
      (app)/[service]/             service, logs, metrics, issues, alerts
  deploy/                          ecosystem, nginx, deploy.sh
```

Every `pnpm` command in this plan runs from `nest-api/` unless it says otherwise.

---

## Task 1: API skeleton

**Files:**
- Create: `nest-api/` (Nest 11 scaffold), `biome.json`, `nest-api/vitest.config.mts`, `nest-api/pnpm-workspace.yaml`

**Interfaces:**
- Produces: a `nest-api` where `pnpm build` succeeds, giving every later task somewhere to write.

**Not a monorepo.** `nest-api/` and, later, `front/` are two standalone projects side by side,
each with its own `package.json` and `node_modules` — the shape Zeus, PFA, spira and trekker all
have. There is no root `package.json`, no `pnpm-workspace.yaml` at the repository root, and no
shared package. Anything the front needs to know about a response shape it restates, which is
what trekker does and says so in the file that does it.

- [ ] **Step 1: Scaffold**

```bash
pnpm dlx @nestjs/cli new api --skip-git --skip-install --package-manager pnpm --directory nest-api
```

`--skip-install` matters: without it the CLI installs into the directory before the manifest is
final, and you throw the result away anyway. Then delete `app.controller.*`, `app.service.*`,
`app.controller.spec.ts`, `test/`, `eslint.config.mjs`, `.prettierrc` and the generated README —
template noise, and the last three are the tooling this repo does not use.

Set `name` to `iknos-api` in `package.json`, matching `trekker-api` and `zeus-nest-api`.

- [ ] **Step 2: Tooling**

`biome.json` at the repository root (from PFA, `lineWidth: 120`, plus `"includes": ["**", "!docs/design", "!mock", "!nest-api/generated"]` — the retained `.dc.html` mockup uses `{{ }}`
interpolation Biome cannot parse, and the generated Prisma client is not ours to lint).

`nest-api/vitest.config.mts` — **`.mts`, and running through `unplugin-swc`**:

```ts
import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.spec.ts", "test/**/*.spec.ts"],
    passWithNoTests: true,
  },
});
```

Two things here are not preference. Vitest's default esbuild transform does not emit
`design:paramtypes`, so **every Nest constructor injection resolves to `undefined`** — and the
failure reads as a broken provider, not a missing compiler flag. SWC emits it. And
`passWithNoTests` because vitest exits 1 on an empty run, which would make the very first
`pnpm test` red and teach everyone to ignore its exit code.

Path aliases in `tsconfig.json` (`@config/*`, `@common/*`, `@auth/*`, `@logs/*`, `@ingest/*`,
`@stream/*`, `@collector/*`, `@search/*`, `@maintenance/*`) so nothing imports across
directories relatively.

- [ ] **Step 3: Verify**

Run, from `nest-api/`: `pnpm install && pnpm build && pnpm check && pnpm test`
Expected: all four succeed. Vitest reports no test files, which is a pass at this stage.

`pnpm install` will refuse to run install scripts until they are allowed; add
`nest-api/pnpm-workspace.yaml` with an `allowBuilds` block for `prisma`, `@prisma/engines`,
`@prisma/client`, `@swc/core` and `esbuild`. Zeus has the same file for the same reason.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "chore: nest-api skeleton"
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
- Create: `nest-api/prisma/schema.prisma`, `nest-api/prisma.config.ts`, `nest-api/src/prisma/prisma.service.ts`, `nest-api/src/prisma/prisma.module.ts`, `nest-api/prisma/seed.ts`, `nest-api/.env.example`
- Modify: the generated migration SQL, by hand

**Interfaces:**
- Produces: an injectable `PrismaService` — the one client in the process — and the four M1 tables. Every later task reads or writes through it.

- [ ] **Step 1: Write the schema**

`nest-api/prisma/schema.prisma` — `provider = "mysql"`, driver adapter `@prisma/adapter-mariadb`, same pairing as PFA.

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

  /// Always true. UNIQUE on it is what makes "there is exactly one account" a guarantee the
  /// database enforces, rather than a `count() === 0` the register route hopes it won the race
  /// for. Copied from Zeus, which reached the same shape for the same reason.
  singleton    Boolean  @unique @default(true)

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

Only `p_future` is created here. The table is correct and writable from the first insert; the sliding window is Task 20's job.

- [ ] **Step 4: Apply and verify the partitioning survived**

Run:

```bash
pnpm prisma migrate dev && mysql iknos -e "SHOW CREATE TABLE log_entry\G"
```

Expected: the output contains `PARTITION BY RANGE (TO_DAYS(ts))`. If the clause is absent, Prisma regenerated the file and dropped the edit — re-apply it and use `migrate resolve` rather than letting `migrate dev` rewrite it.

- [ ] **Step 5: Check Prisma does not consider the table drifted**

Run:

```bash
pnpm prisma migrate diff --from-config-datasource --to-schema nest-api/prisma/schema.prisma --exit-code
```

Prisma 7 renamed both flags: `--from-schema-datasource` became `--from-config-datasource` (the
datasource now comes from `prisma.config.ts`, not the schema), and `--to-schema-datamodel` was
removed in favour of `--to-schema`. The 6.x spelling exits 1 with a usage dump, which is easy to
mistake for a passing run if you only look at the last line.

Expected: exit code 0, no drift. Partitioning is a table attribute Prisma does not model, so it should be invisible to the diff. **If it does report drift, stop and solve it here** — a schema that Prisma wants to "fix" on every migration will silently drop the partitioning the first time someone runs `migrate dev` in a hurry.

- [ ] **Step 6: Export the client and seed the registry**

`nest-api/src/prisma/prisma.service.ts` — an `@Injectable()` extending `PrismaClient`, built on the mariadb adapter, exported by a `@Global()` `PrismaModule`. Trekker's and Zeus's shape exactly.

One instance for the process, never one per module: the collector and the API share it, and a second client would be a second connection pool competing with the first for the same MySQL — with the Service view's pool gauge then measuring one of two without saying which.

The import of the generated client stays **relative** (`../../generated/prisma/client`), not aliased: an `@prisma/*` path alias would shadow the npm scope the Prisma packages themselves live in.

`nest-api/prisma/seed.ts` inserts four rows into `service`: `pfa-api` / `pfa-nest-api`, `pfa-front` / `pfa-front`, and **Iknos' own two processes**, `iknos-api` / `iknos-api` and `iknos-web` / `iknos-web`.

Seeding Iknos itself is not vanity. It monitors itself through its own pipeline (spec §3.3), and without those two rows the service rail shows a single application on the day the milestone ships — losing the most convincing demonstration the tool has. `nginx` is deliberately absent: it is not a PM2 process and its logs come from elsewhere (`IKN-16`).

Write `.env.example` with `DATABASE_URL`, `REDIS_URL`, `IKNOS_PORT`, `IKNOS_LOG_LEVEL`, `IKNOS_COOKIE_SECRET`, `IKNOS_RETENTION_DAYS`, `IKNOS_PM2_LOG_GLOB`.

No variable controls registration. It seals itself once the account exists (Task 11), which is why `singleton` is in the schema from the first migration rather than added later: the CLI in Task 10 must not be able to create the second account that would make that constraint impossible to add.

- [ ] **Step 7: Commit**

```bash
git add nest-api/prisma nest-api/prisma.config.ts nest-api/src/prisma nest-api/.env.example
git commit -m "feat(db): prisma schema with day-partitioned log_entry"
```

---

## Task 4: Validated configuration

**Files:**
- Create: `nest-api/src/config/env.ts`, `nest-api/src/config/env.spec.ts`

**Interfaces:**
- Produces: `parseEnv(source: Record<string, string | undefined>): Config` throwing a named error, and the `Config` type with `databaseUrl`, `redisUrl`, `port`, `logLevel`, `cookieSecret`, `retentionDays`, `pm2LogGlob`. Registered in `ConfigModule` so every service injects the typed object, never `process.env`.

- [ ] **Step 1: Write the failing test**

`nest-api/src/config/env.spec.ts`:

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

Run: `pnpm test src/config`
Expected: FAIL — cannot resolve `./env`.

- [ ] **Step 3: Implement it**

`nest-api/src/config/env.ts`:

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

Run: `pnpm test src/config`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add nest-api/src/config
git commit -m "feat(api): validated environment configuration"
```

---

## Task 5: Exception filter

**Files:**
- Create: `nest-api/src/common/all-exceptions.filter.ts`, `nest-api/src/common/all-exceptions.filter.spec.ts`

**Interfaces:**
- Produces: `AllExceptionsFilter`, registered as `APP_FILTER`. Every controller can throw freely from here on.

- [ ] **Step 1: Write the failing test**

`nest-api/src/common/all-exceptions.filter.spec.ts`:

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

Run: `pnpm test src/common`
Expected: FAIL — cannot resolve `./all-exceptions.filter`.

- [ ] **Step 3: Implement it**

`nest-api/src/common/all-exceptions.filter.ts`:

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

Run: `pnpm test src/common`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add nest-api/src/common
git commit -m "feat(api): global exception filter that never leaks detail"
```

---

## Task 6: ECS logging and the self-error marker

**Files:**
- Create: `nest-api/src/common/logger.ts`, `nest-api/src/common/logger.spec.ts`

**Interfaces:**
- Produces: `logger` (a pino instance emitting ECS), and `INGEST_SKIP_MARKER = "IKNOS_SELF_ERR"`. Task 13's parser must skip lines containing the marker; Task 16's writer prints it on database failure.

- [ ] **Step 1: Write the failing test**

`nest-api/src/common/logger.spec.ts`:

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

Run: `pnpm test src/common/logger`
Expected: FAIL — cannot resolve `./logger`.

- [ ] **Step 3: Implement it**

Install `pino`, `@elastic/ecs-pino-format` and `nestjs-pino`.

`nest-api/src/common/logger.ts`:

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

Run: `pnpm test src/common`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add nest-api/src/common
git commit -m "feat(api): ECS-shaped logging and the self-error marker"
```

---

## Task 7: Bootstrap, /health, shutdown and BigInt serialization

**Files:**
- Create: `nest-api/src/health.controller.ts`, `nest-api/test/health.e2e-spec.ts`
- Modify: `nest-api/src/main.ts`, `nest-api/src/app.module.ts`

**Interfaces:**
- Produces: a running server on `127.0.0.1:<port>` serving `GET /health`. Tasks 10, 16, 17 add controllers to the same app.

- [ ] **Step 1: Write the failing test**

`nest-api/test/health.e2e-spec.ts`:

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

Run: `pnpm test test/health`
Expected: FAIL — 404, no such route.

- [ ] **Step 3: Implement the controller**

`nest-api/src/health.controller.ts`:

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

`nest-api/src/main.ts`:

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

`LogEntry.id` is a `BigInt`, and `JSON.stringify` throws `TypeError: Do not know how to serialize a BigInt` the first time a log row reaches a response. Fix it at the DTO boundary — Task 17 maps `id` to a string explicitly.

Do **not** patch `BigInt.prototype.toJSON` globally. It looks like a one-line fix, but it silently turns every BigInt anywhere into a string, including in places where you would rather have had the error.

Add a test that locks the decision in, in `nest-api/test/health.e2e-spec.ts`:

```ts
it("BigInt is not globally patched", () => {
  expect(() => JSON.stringify({ n: 1n })).toThrow(TypeError);
});
```

- [ ] **Step 6: Run the tests and check it starts**

Run: `pnpm test test`
Expected: PASS, 2 tests.

Then:

```bash
pnpm start &
sleep 3 && curl -s localhost:4310/health && ss -tlnp | grep 4310 && kill -TERM %1
```

Expected: `{"status":"ok"}`; `ss` shows `127.0.0.1:4310` and **not** `0.0.0.0:4310`; the process exits cleanly. The first log line is ECS JSON containing `"log.level":"info"`.

- [ ] **Step 7: Commit**

```bash
git add nest-api
git commit -m "feat(api): bootstrap, health check and graceful shutdown"
```

---

## Task 8: Redis session store

**Files:**
- Create: `nest-api/src/redis/redis.service.ts`, `nest-api/src/redis/redis.module.ts`, `nest-api/src/redis/redis.service.spec.ts`
- Create: `nest-api/src/auth/session.constants.ts`, `nest-api/src/auth/session.middleware.ts`
- Create: `nest-api/src/types/express-session.d.ts`
- Create: `nest-api/test/session.e2e-spec.ts`, `nest-api/test/setup-env.ts`
- Modify: `nest-api/src/main.ts`, `nest-api/src/app.module.ts`, `nest-api/vitest.config.mts`, `biome.json`

**Interfaces:**
- Produces: `RedisService` with `getClient(): RedisClientType`, `ready(): Promise<void>` and `clearSessionsForUser(userId: number)`; `SESSION_PREFIX = "iknos:sess:"`; `buildSessionMiddleware(client, secret, secure)`; `SESSION_COOKIE_NAME`, `SESSION_TTL_SECONDS`; and `SessionData` augmented with `userId?: number` and `csrfToken?: string`. Tasks 9–11 read and write `req.session` directly.

**This is the fleet's session, not a bespoke one.** Zeus, spira, trekker and PFA all run `express-session` + `connect-redis` on top of `redis@5`, with a `RedisService` wrapping one client. Iknos does the same, and `IKN-6` says so outright — *« on recopie le code »*. Nothing here is hand-rolled: `express-session` owns the cookie, its signature and the sliding TTL; `connect-redis` owns the store; the only Iknos-specific code is `clearSessionsForUser` and the middleware's configuration.

Deviations from trekker, both deliberate: the TTL is **2h** rather than 1h — a dashboard lives in a tab — and the middleware is built by a **function** rather than inlined in `main.ts`, so the tests exercise the configuration that ships instead of a MemoryStore standing in for it.

- [ ] **Step 1: Add the dependencies**

```bash
cd nest-api
pnpm add redis@^5.11.0 connect-redis@^10.0.0 express-session@^1.19.0
pnpm add -D @types/express-session@^1.19.0
```

`redis`, not `ioredis`: four sibling APIs already use the former, and a fleet with two Redis clients is a fleet where the next person guesses wrong.

- [ ] **Step 2: Put Biome where the fleet puts it**

The fleet splits its Biome configuration in two, and Iknos must match — Zeus, spira, trekker, pfa and worldweathr all do:

- **`biome.json` at the repository root**: `"root": true`, `vcs` and `files` only. No formatter, no linter, no rules. It exists to mark the root and to turn on `.gitignore` handling, nothing else.
- **`nest-api/biome.json`**: `"root": false` and the whole configuration — `lineWidth: 120`, double quotes, `preset: "recommended"`, and the `organizeImports` groups that put type imports in a trailing block. Copy worldweathr's `api/biome.json`, which is the fleet's Nest-side one. `front/biome.json` arrives with Task 22 and is the front variant, with the `css.parser.tailwindDirectives` block the API has no use for.

Nothing ever runs Biome from the repository root; `pnpm check` runs inside `nest-api`, which is why the nested config is the one that matters. `generated/` needs no exclusion — it is in `.gitignore` and `useIgnoreFile` is on.

The Nest-side config carries one option the front's does not, and it is not optional: every route argument from Task 9 onwards is a parameter decorator (`@Req`, `@Body`, `@Param`), which Biome refuses to parse by default.

```json
"javascript": {
  "parser": {
    "unsafeParameterDecoratorsEnabled": true
  }
}
```

Without it the controller files fail to *parse*, so they are neither linted nor formatted — and the run still reports success.

**`biome.json` is strict JSON and does not accept `//` comments.** A comment makes the whole config fail to load *silently*, and Biome falls back to its defaults: tabs, **80 columns**, and none of the ignore rules. A single `--write` in that state reformats every file it can reach.

- [ ] **Step 3: Make `.env` reachable from unit tests**

`nest-api/test/setup-env.ts`:

```ts
try {
  process.loadEnvFile();
} catch {
  // No .env: CI and ks-b both provide the environment directly.
}
```

and in `vitest.config.mts`: `setupFiles: ["reflect-metadata", "./test/setup-env.ts"]`.

The e2e suites already get this for free — `ConfigModule.forRoot({ envFilePath })` reads the file while the imports array is evaluated, before any provider is constructed. A unit spec that instantiates one service never imports `AppModule`, so without this it falls back to a default URL and passes for the wrong reason.

- [ ] **Step 4: Write the failing RedisService test**

`nest-api/src/redis/redis.service.spec.ts` — against a real Redis, because the failure modes worth catching (a wrong SCAN pattern, one malformed entry aborting the sweep) are exactly the ones a fake is written not to have. Every key carries a random suffix and is deleted afterwards, so a run cannot collide with a live session.

```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RedisService, SESSION_PREFIX } from "./redis.service";

describe("RedisService", () => {
  let service: RedisService;
  const written: string[] = [];
  const run = randomUUID();

  async function writeSession(sid: string, value: string): Promise<string> {
    const key = `${SESSION_PREFIX}${run}-${sid}`;
    await service.getClient().set(key, value);
    written.push(key);
    return key;
  }

  beforeAll(async () => {
    service = new RedisService();
    service.onModuleInit();
    await service.ready();
  });

  afterAll(async () => {
    if (written.length > 0) await service.getClient().del(written);
    await service.onModuleDestroy();
  });

  it("connects", () => {
    expect(service.getClient().isReady).toBe(true);
  });

  it("deletes only the sessions belonging to the user", async () => {
    const mine = await writeSession("mine", JSON.stringify({ userId: 1 }));
    const theirs = await writeSession("theirs", JSON.stringify({ userId: 2 }));

    await service.clearSessionsForUser(1);

    expect(await service.getClient().exists(mine)).toBe(0);
    expect(await service.getClient().exists(theirs)).toBe(1);
  });

  it("finishes the sweep when an entry is not valid JSON", async () => {
    await writeSession("garbage", "{not json");
    const mine = await writeSession("after-garbage", JSON.stringify({ userId: 3 }));

    await service.clearSessionsForUser(3);

    expect(await service.getClient().exists(mine)).toBe(0);
  });

  it("does not touch keys outside the session prefix", async () => {
    const foreign = `iknos:not-a-session:${run}`;
    await service.getClient().set(foreign, JSON.stringify({ userId: 4 }));
    written.push(foreign);

    await service.clearSessionsForUser(4);

    expect(await service.getClient().exists(foreign)).toBe(1);
  });
});
```

Run: `pnpm test src/redis`
Expected: FAIL — cannot resolve `./redis.service`.

- [ ] **Step 5: Implement RedisService**

`nest-api/src/redis/redis.service.ts` — trekker's, with `userId` typed as a number:

```ts
import { Injectable, Logger } from "@nestjs/common";
import { createClient } from "redis";

import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { RedisClientType } from "redis";

export const SESSION_PREFIX = "iknos:sess:";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: RedisClientType;
  private connection: Promise<void> = Promise.resolve();

  constructor() {
    this.client = createClient({
      url: process.env.REDIS_URL,
      // Without this, a command issued while the connection is down is queued until it comes
      // back — so a request hangs for as long as Redis is out rather than failing.
      disableOfflineQueue: true,
      socket: {
        // Redis being down is a degraded state, not a reason for the API to die.
        reconnectStrategy: (retries) => Math.min(1000 * 2 ** retries, 30_000),
      },
    });

    // node-redis throws on an unhandled "error" event, which would take the process with it.
    this.client.on("error", (error: Error) => {
      this.logger.warn(`Redis unavailable: ${error.message}`);
    });
    this.client.on("ready", () => {
      this.logger.log("Redis connected");
    });
  }

  onModuleInit(): void {
    // Not awaited, and that is the point. With a reconnect strategy that never gives up,
    // `connect()` does not reject when Redis is down — it never settles. Awaiting it would hang
    // module init and the API would never reach `listen()`.
    this.connection = this.client.connect().then(
      () => undefined,
      (error: Error) => {
        this.logger.warn(`Redis not reachable at startup, retrying in background: ${error.message}`);
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.quit();
    }
  }

  /** Resolves once the first connection attempt has settled. For tests; bootstrap never awaits it. */
  ready(): Promise<void> {
    return this.connection;
  }

  getClient(): RedisClientType {
    return this.client;
  }

  /**
   * SCAN rather than KEYS: KEYS blocks the Redis event loop for the whole sweep, and this runs
   * on a request path against a Redis shared with every other app on the box.
   */
  async clearSessionsForUser(userId: number): Promise<void> {
    for await (const keys of this.client.scanIterator({ MATCH: `${SESSION_PREFIX}*`, COUNT: 100 })) {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        try {
          const value = await this.client.get(key);
          if (!value) continue;
          const session = JSON.parse(value) as { userId?: number };
          if (session.userId === userId) {
            await this.client.del(key);
          }
        } catch {
          // A malformed entry is not a reason to leave the rest of the user's sessions alive.
        }
      }
    }
  }
}
```

`nest-api/src/redis/redis.module.ts` — `@Global()`, `providers: [RedisService]`, `exports: [RedisService]`, exactly like `PrismaModule`. Add it to `AppModule`'s imports.

Run: `pnpm test src/redis`
Expected: PASS, 4 tests.

- [ ] **Step 6: Declare what a session holds**

`nest-api/src/types/express-session.d.ts`:

```ts
import "express-session";

declare module "express-session" {
  interface SessionData {
    userId?: number;
    csrfToken?: string;
  }
}
```

Typed once, so `req.session.userId` needs no cast at any use site — the casts are what let a typo compile.

- [ ] **Step 7: Build the session middleware**

`nest-api/src/auth/session.constants.ts`:

```ts
export const SESSION_COOKIE_NAME = "iknos.sid";
/** Rolling: every request pushes the expiry back, so this measures inactivity, not age. */
export const SESSION_TTL_SECONDS = 2 * 60 * 60;
```

`nest-api/src/auth/session.middleware.ts`:

```ts
import { randomBytes } from "node:crypto";
import { RedisStore } from "connect-redis";
import session from "express-session";
import { SESSION_PREFIX } from "../redis/redis.service";
import { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from "./session.constants";

import type { RequestHandler } from "express";
import type { RedisClientType } from "redis";

const SESSION_ID_BYTES = 32;

export function buildSessionMiddleware(client: RedisClientType, secret: string, secure: boolean): RequestHandler {
  return session({
    name: SESSION_COOKIE_NAME,
    store: new RedisStore({ client, prefix: SESSION_PREFIX, ttl: SESSION_TTL_SECONDS }),
    secret,
    genid: () => randomBytes(SESSION_ID_BYTES).toString("base64url"),
    resave: false,
    // No Redis entry and no Set-Cookie until there is something to remember, so an
    // unauthenticated probe of /health cannot fill a keyspace shared with the other apps.
    saveUninitialized: false,
    rolling: true,
    proxy: true,
    cookie: {
      httpOnly: true,
      secure,
      // Lax and not Strict: this is what protects the login POST, which by definition has no
      // CSRF token to present yet.
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_SECONDS * 1000,
    },
  });
}
```

`secure` is a parameter rather than a `NODE_ENV` read, so a test can set it both ways.

In `main.ts`, after `parseEnv` and before `listen`:

```ts
// Behind nginx. Without this, req.ip is the proxy — so Task 10's rate limit would count the
// whole internet as one client — and a Secure cookie is never set.
(app.getHttpAdapter().getInstance() as Application).set("trust proxy", 1);

app.use(
  buildSessionMiddleware(app.get(RedisService).getClient(), cookieSecret, process.env.NODE_ENV === "production"),
);
```

- [ ] **Step 8: Write the session e2e test**

`nest-api/test/session.e2e-spec.ts` mounts a throwaway `POST /test-session/login/:userId` and `GET /test-session/whoami` on `AppModule`, applies `buildSessionMiddleware` before `init()`, and asserts:

1. a request that stores nothing gets no `Set-Cookie` and writes no key (`saveUninitialized: false`);
2. once the session holds something the cookie is `HttpOnly`, `SameSite=Lax`, `Path=/` and signed (`iknos.sid=s%3A…`);
3. the session survives across requests;
4. the key sits under `iknos:sess:` with a TTL within a minute of 7200;
5. after `EXPIRE key 10`, one more request puts the TTL back near 7200 — the slide;
6. `clearSessionsForUser` makes the cookie stop working;
7. a second, `AppModule`-free app built with `secure: true` and `trust proxy` marks the cookie `Secure` when `X-Forwarded-Proto: https` is set.

**Give every test its own user id.** The session key is found by scanning for the user it belongs to, so two tests logging in as the same user leave two matching keys and the lookup returns whichever the SCAN reaches first — which is how a sliding-TTL assertion ends up measuring a session nobody touched, and reports `expected 10 to be greater than 7140`.

Run: `pnpm test`
Expected: PASS, 29 tests across 6 files.

- [ ] **Step 9: Verify against the real process**

```bash
pnpm build && node dist/src/main.js
curl -si http://127.0.0.1:4310/health | head -3
redis-cli --scan --pattern 'iknos:*' | wc -l
```

Expected: `200 OK`, **no `Set-Cookie` header**, and **0** Redis keys — `/health` is the one route the world can reach unauthenticated, and it must not be able to write to Redis.

- [ ] **Step 10: Commit**

```bash
git add nest-api/ biome.json
git commit -m "feat(auth): redis session store on express-session, the fleet's shape (IKN-6)"
```

---

## Task 9: CSRF and the global session guard

**Files:**
- Create: `nest-api/src/auth/csrf.util.ts`, `nest-api/src/auth/csrf.util.spec.ts`, `nest-api/src/auth/public.decorator.ts`, `nest-api/src/auth/session.guard.ts`, `nest-api/test/session-guard.e2e-spec.ts`
- Modify: `nest-api/src/app.module.ts` (`APP_GUARD`), `nest-api/src/health.controller.ts` (`@Public()`), `nest-api/test/session.e2e-spec.ts` (`@Public()` on its probe controller)

**Interfaces:**
- Consumes: `req.session` as populated by Task 8's middleware.
- Produces: `verifyCsrf(expected, provided): boolean` (constant time), the `@Public()` decorator, `CSRF_HEADER`, and `SessionGuard` registered as `APP_GUARD`. Handlers can assume `req.session.userId` is set from here on.

- [ ] **Step 1: Write the failing CSRF test**

`nest-api/src/auth/csrf.util.spec.ts`:

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

Run: `pnpm test src/auth/csrf`
Expected: FAIL — cannot resolve `./csrf.util`.

- [ ] **Step 3: Implement it**

`nest-api/src/auth/csrf.util.ts` — same shape as PFA's `csrf-token.util.ts`:

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

`nest-api/src/auth/public.decorator.ts`:

```ts
import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC = "iknos:public";
export const Public = () => SetMetadata(IS_PUBLIC, true);
```

`nest-api/src/auth/session.guard.ts`:

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

import type { Request } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
export const CSRF_HEADER = "x-csrf-token";

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // No store lookup here: the session middleware from Task 8 already verified the cookie's
    // signature, loaded the record out of Redis and slid its TTL. By the time a guard runs,
    // `req.session` is either populated or the cookie was never valid.
    const req = context.switchToHttp().getRequest<Request>();
    if (!req.session?.userId) throw new UnauthorizedException();

    // CSRF applies to every unsafe verb, not just POST.
    if (!SAFE_METHODS.has(req.method)) {
      if (!verifyCsrf(req.session.csrfToken ?? "", (req.headers[CSRF_HEADER] as string) ?? "")) {
        throw new ForbiddenException();
      }
    }

    return true;
  }
}
```

Register it globally in `AppModule`:

```ts
providers: [{ provide: APP_GUARD, useClass: SessionGuard }]
```

Global, never per-controller: a controller added six months from now is protected because it exists, not because someone remembered.

No `cookie-parser`: `express-session` parses and verifies its own signed cookie. Adding one would give two libraries an opinion about `iknos.sid` and neither the authority.

- [ ] **Step 5: Exempt the routes that must answer without a session**

`@Public()` goes on `HealthController` — Zeus's registry probes `/health` with no cookie, and a 401 there reads as the whole app being down.

It also goes on the probe controller inside `test/session.e2e-spec.ts`. Those assertions are about the middleware, not the guard; without the exemption the guard answers 401 before any of them gets to look at a cookie, and Task 8's suite goes red for a reason that has nothing to do with Task 8.

- [ ] **Step 6: Verify the default-deny property, permanently**

Not a temporary controller deleted afterwards — a suite that stays. `nest-api/test/session-guard.e2e-spec.ts` registers a `ProtectedController` **carrying no decorator of any kind**, which is precisely the controller a future task adds without thinking about auth. It asserts:

1. anonymous `GET` on the undecorated controller → **401**;
2. anonymous `POST` → **401**, not 403 — there is no session to hold a token, so "your token was wrong" is the wrong answer;
3. a forged cookie → **401** (the signature never verifies, so no session is loaded);
4. `/health` → **200** with no session, and the `@Public()` login route likewise;
5. with a session, a safe verb needs no token;
6. with a session, an unsafe verb with **no** token → 403, with a **wrong** token of the same length → 403, with the right one → 201;
7. `DELETE` is checked the same as `POST` — the rule is "every unsafe verb", not "POST".

Run: `pnpm test`
Expected: PASS, 43 tests across 8 files.

Then confirm the real process still serves the one route the internet can reach:

```bash
pnpm build && node dist/src/main.js
curl -si http://127.0.0.1:4310/health | head -3
```

Expected: `200`, `{"status":"ok"}`, still no `Set-Cookie`.

- [ ] **Step 7: Commit**

```bash
git add nest-api/src/auth
git commit -m "feat(auth): global session guard with constant-time csrf check"
```

---

## Task 10: Auth controller, rate limiting and the user CLI

**Files:**
- Create: `nest-api/src/auth/password.util.ts`, `nest-api/src/auth/password.util.spec.ts`, `nest-api/src/auth/auth.controller.ts`, `nest-api/src/auth/ratelimit.service.ts`, `nest-api/src/auth/users.service.ts`, `nest-api/scripts/create-account.ts`, `nest-api/test/auth.e2e-spec.ts`

**Interfaces:**
- Produces: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/csrf`, `GET /api/me`. Every later route sits behind the guard these establish.

`POST /api/auth/login` is `@Public()` and carries **no** CSRF check — there is no session yet to mint a token from. `SameSite=Lax` is what protects it from cross-site submission.

- [ ] **Step 1: Write the failing test**

`nest-api/test/auth.e2e-spec.ts`:

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

`nest-api/test/helpers.ts` builds the app from `AppModule`, applies `buildSessionMiddleware` before `init()` exactly as `main.ts` does, and returns it. The rate-limit test needs a distinct client IP per run or a Redis flush of the `iknos:rl:` prefix in `beforeEach`, otherwise reruns start already throttled.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test test/auth`
Expected: FAIL — routes 404.

- [ ] **Step 3: Implement the rate limiter**

`nest-api/src/auth/ratelimit.service.ts`:

```ts
import { Injectable } from "@nestjs/common";
import { RedisService } from "../redis/redis.service";

const MAX_ATTEMPTS = 5;
const WINDOW_SECONDS = 60;

@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  /** Fixed window. Returns false once the budget is spent. */
  async allow(ip: string): Promise<boolean> {
    const key = `iknos:rl:login:${ip}`;
    const client = this.redis.getClient();
    const count = await client.incr(key);
    if (count === 1) {
      // Only the first call in a window sets the expiry, so a burst cannot keep
      // pushing the window forward and lock the caller out indefinitely.
      await client.expire(key, WINDOW_SECONDS);
    }
    return count <= MAX_ATTEMPTS;
  }
}
```

- [ ] **Step 4: Hash passwords with `node:crypto`, no dependency**

No `bcryptjs`, despite the four sibling APIs using it and `IKN-6` naming it. Node ships a memory-hard KDF, and OWASP ranks scrypt above bcrypt precisely because bcrypt is not memory-hard. `bcryptjs` is also a pure-JS reimplementation rather than a binding, so dropping it removes a dependency instead of adding one.

**`crypto.argon2` is not an option, even though it would rank higher still.** It exists from Node 24.11 and ks-b runs **v24.3.0**, where it is `undefined` — it would compile on a developer machine and throw on the box. Re-measure before reaching for it; do not assume a version.

Measured at these parameters: **266 ms** locally, **310 ms on ks-b**. That is the intended cost, and it is affordable because the only route that pays it is rate-limited to five attempts a minute.

`nest-api/src/auth/password.util.ts`:

```ts
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

// OWASP's scrypt parameters. They are written into every hash rather than assumed, so raising
// them later is a one-line change that leaves existing accounts able to log in.
const N = 2 ** 17;
const R = 8;
const P = 1;
const KEY_BYTES = 32;
const SALT_BYTES = 16;

/** 128 * N * r is ~134 MiB here, and scrypt's default ceiling is 32 MiB — without this it
 *  refuses the parameters outright rather than running slowly. */
function maxmemFor(n: number, r: number): number {
  return Math.max(256 * 1024 * 1024, 128 * n * r * 2);
}

/** `scrypt$N$r$p$salt$key`, all base64. Self-describing, so verify never has to guess. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = (await scryptAsync(password, salt, KEY_BYTES, {
    N,
    r: R,
    p: P,
    maxmem: maxmemFor(N, R),
  })) as Buffer;

  return ["scrypt", N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, saltB64, keyB64] = parts;
  const [nn, rr, pp] = [Number(n), Number(r), Number(p)];
  if (!Number.isInteger(nn) || !Number.isInteger(rr) || !Number.isInteger(pp)) return false;

  const key = Buffer.from(keyB64, "base64");
  // Parameters come from the stored hash, never from the constants above: an account created
  // before a cost increase has to keep verifying against the cost it was created with.
  const derived = (await scryptAsync(password, Buffer.from(saltB64, "base64"), key.length, {
    N: nn,
    r: rr,
    p: pp,
    maxmem: maxmemFor(nn, rr),
  })) as Buffer;

  return timingSafeEqual(key, derived);
}
```

Async, not `scryptSync`, and this is not a preference. Iknos runs the collector in the same process as the API — a synchronous derivation would stall log ingestion for a third of a second on every login attempt, including the failed ones.

Write `password.util.spec.ts` alongside: a round trip verifies; a wrong password does not; two hashes of the same password differ (the salt is random); a truncated or non-scrypt string returns `false` rather than throwing; and a hash carrying different parameters than the current constants still verifies.

- [ ] **Step 5: Implement the controller**

`nest-api/src/auth/auth.controller.ts` — the shape below, hashing through `password.util.ts`:

```ts
@Public()
@Post("api/auth/login")
async login(@Body() body: LoginDto, @Req() req, @Res({ passthrough: true }) res) {
  if (!(await this.rateLimit.allow(req.ip))) throw new HttpException("", 429);

  const user = await this.users.findByEmail(body.email);
  // Derive against a dummy hash when the account is missing, so a nonexistent account and a
  // wrong password cost the same 300ms and return the same body. `&& false` and not `||`:
  // the derivation still has to run, its result just must not be able to grant anything.
  const ok = user
    ? await verifyPassword(body.password, user.passwordHash)
    : (await verifyPassword(body.password, DUMMY_HASH)) && false;
  if (!user || !ok) throw new UnauthorizedException();

  // One session per user: the previous cookie has to stop working before the new one exists.
  await this.redis.clearSessionsForUser(user.id);

  // The middleware writes the record and sets the cookie on its own; the handler only says
  // what the session holds. Rotating the CSRF token here is what makes a token captured
  // before login useless after it.
  req.session.userId = user.id;
  req.session.csrfToken = randomBytes(32).toString("base64url");

  return { userId: user.id, csrfToken: req.session.csrfToken };
}
```

`@Res({ passthrough: true })` is no longer needed on `login` — nothing sets a cookie by hand.

`logout` calls `req.session.destroy(...)` and `res.clearCookie(SESSION_COOKIE_NAME)`; `GET /api/csrf` returns `req.session.csrfToken`, creating one if the session has none; `GET /api/me` returns `{ userId }`. Generate `DUMMY_HASH` once with `node -e 'import("./dist/src/auth/password.util.js").then(m => m.hashPassword("a password nobody has").then(console.log))'` and paste the real value — a constant, not a value computed at boot, so startup does not pay 300 ms for a string that never changes.

Trust the proxy so `req.ip` is the real client: `app.set("trust proxy", 1)` in `main.ts`, paired with nginx setting `X-Forwarded-For` in Task 31. Without both, every request looks like `127.0.0.1` and five failures lock out everyone.

- [ ] **Step 6: Add the user CLI**

`nest-api/scripts/create-account.ts` — reads an email argument, prompts twice for a password without echoing, rejects anything under 12 characters, hashes with `hashPassword`, inserts. Wire it as `pnpm seed:user`. No `POST /users`.

The CLI stays password-only here because the column that stores a recovery passphrase does not exist yet — Task 11 adds it and extends this same script.

It creates **the** account, not **an** account: `singleton` (Task 3) makes a second one fail on a unique constraint. That is deliberate, and it is the same mechanism that seals registration in Task 11.

- [ ] **Step 7: Run the tests, then check from outside**

Run: `pnpm seed:user test@iknos.local` then `pnpm test test/auth`
Expected: PASS, 5 tests.

Then with the server up:

```bash
curl -si localhost:4310/api/me | head -1
```

Expected: `HTTP/1.1 401 Unauthorized`. This is the spec's acceptance criterion — verified in `curl`, not only in a browser.

- [ ] **Step 8: Commit**

```bash
git add nest-api nest-api/src/prisma
git commit -m "feat(auth): login, logout, csrf, me and login rate limiting"
```

---

## Task 11: Registration, recovery and password change

**Files:**
- Create: `nest-api/src/auth/passphrase.util.ts`, `nest-api/src/auth/passphrase.util.spec.ts`, `nest-api/src/auth/account.controller.ts`, `nest-api/test/account.e2e-spec.ts`
- Modify: `nest-api/prisma/schema.prisma`, `nest-api/src/auth/users.service.ts`, `nest-api/src/auth/ratelimit.service.ts`, `nest-api/scripts/create-account.ts`

**Interfaces:**
- Consumes: `SessionService` (Task 8), `@Public()` and `SessionGuard` (Task 9), `RateLimitService` and `UsersService` (Task 10), `app_user.singleton` (Task 3).
- Produces: `GET /api/auth/bootstrap`, `POST /api/auth/register`, `POST /api/auth/recover`, `POST /api/auth/password`, the column `app_user.recovery_passphrase_hash`, and `verifyPassphrase(hash, provided)`. Task 24 builds the four screens on these.

ks-b has no mail server and is not getting one, so a reset link is not available. The way back into an account is a passphrase chosen when it was created. That single constraint is why this task exists at all.

**This is Zeus's auth shape, copied deliberately.** Zeus is the closest sibling — an internal single-account console on the same box, with the same no-mail constraint — and it already answers every question here: `GET /auth/bootstrap` returning `{ sealed }`, a register route that is first-run only and seals itself, a recovery passphrase hashed independently of the password, and identical refusals across every recovery failure. Read `~/dev/Zeus/nest-api/src/auth/auth.service.ts` before writing this task; do not re-derive it.

The one thing worth restating rather than assuming: **registration is gated by whether the account exists, not by an environment variable.** No flag to set, none to forget, and no way to reopen it by editing a `.env` in a hurry. The seal is a `UNIQUE` constraint, so it holds even against two requests in the same millisecond.

- [ ] **Step 1: Add the column**

In `nest-api/prisma/schema.prisma`, on `AppUser`:

```prisma
  /// Hashed independently of the password: the passphrase can reset the password, so knowing
  /// one must never reveal the other.
  recoveryPassphraseHash String? @map("recovery_passphrase_hash") @db.VarChar(255)
```

Nullable, deliberately: accounts created by the CLI before this task keep working and simply have no way back. `singleton` is already there from Task 3, so this migration adds one column and no constraint. Then:

```bash
pnpm prisma migrate dev --name account_recovery
```

Expected: an additive migration adding one nullable column, no table rewrite.

- [ ] **Step 2: Write the failing unit test**

`nest-api/src/auth/passphrase.util.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hashPassphrase, verifyPassphrase } from "./passphrase.util";

describe("verifyPassphrase", () => {
  it("accepts the passphrase it was given", async () => {
    const hash = await hashPassphrase("correct horse battery staple ok");
    expect(await verifyPassphrase(hash, "correct horse battery staple ok")).toBe(true);
  });

  it("rejects a different passphrase", async () => {
    const hash = await hashPassphrase("correct horse battery staple ok");
    expect(await verifyPassphrase(hash, "incorrect horse battery staple")).toBe(false);
  });

  it("rejects an account with no passphrase, and still pays the derivation cost", async () => {
    const started = performance.now();
    expect(await verifyPassphrase(null, "anything at all, long enough")).toBe(false);

    // scrypt at these parameters takes ~300ms. An early `return false` on the null
    // hash would take approximately zero — making "this account has no passphrase"
    // measurable with a stopwatch, which is exactly the list of unrecoverable
    // accounts an attacker would like to have.
    expect(performance.now() - started).toBeGreaterThan(50);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm test src/auth/passphrase`
Expected: FAIL — cannot resolve `./passphrase.util`.

- [ ] **Step 4: Implement it**

`nest-api/src/auth/passphrase.util.ts`:

```ts
import { hashPassword, verifyPassword } from "./password.util";

export const MIN_PASSWORD = 12;
export const MIN_PASSPHRASE = 20;

/** Generate once the same way as Task 10's `DUMMY_HASH`, and paste the real value here. */
export const DUMMY_PASSPHRASE_HASH = "scrypt$131072$8$1$REPLACE$WITH_A_REAL_HASH";

/** The passphrase is a password by another name — same KDF, same parameters, one place to
 *  raise the cost. It is not a second scheme just because it protects a second thing. */
export function hashPassphrase(passphrase: string): Promise<string> {
  return hashPassword(passphrase);
}

/** Always runs a derivation, including against the dummy hash, so an account
 *  with no passphrase costs the same as a wrong one. */
export async function verifyPassphrase(
  hash: string | null,
  provided: string,
): Promise<boolean> {
  const matched = await verifyPassword(provided, hash ?? DUMMY_PASSPHRASE_HASH);
  return hash !== null && matched;
}

/** Names the offending field and never echoes the value — a 400 that quotes the
 *  rejected password writes it into the access log of every proxy in between. */
export function assertLength(value: string | undefined, min: number, field: string): void {
  if (!value || value.length < min) {
    throw new Error(`${field} must be at least ${min} characters`);
  }
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm test src/auth/passphrase`
Expected: PASS, 3 tests.

- [ ] **Step 6: Write the failing endpoint tests**

`nest-api/test/account.e2e-spec.ts`:

```ts
import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildTestApp, login } from "./helpers";

const PASSPHRASE = "a recovery passphrase of ample length";
const PASSWORD = "a-long-enough-password";

describe("account", () => {
  it("reports the seal once an account exists", async () => {
    const app = await buildTestApp({ seeded: true });
    const res = await request(app.getHttpServer()).get("/api/auth/bootstrap").expect(200);

    expect(res.body).toEqual({ sealed: true });
  });

  it("registers on a fresh instance, and opens no session", async () => {
    const app = await buildTestApp({ seeded: false });
    const res = await request(app.getHttpServer())
      .post("/api/auth/register")
      .send({ email: "first@iknos.local", password: PASSWORD, passphrase: PASSPHRASE })
      .expect(201);

    // No cookie on purpose: the front lands on /login, which proves the password
    // works before it becomes the only way in.
    expect(res.headers["set-cookie"]).toBeUndefined();
    await login(app, "first@iknos.local", PASSWORD);
  });

  it("seals itself the moment it succeeds", async () => {
    const app = await buildTestApp({ seeded: false });
    const send = (email: string) =>
      request(app.getHttpServer())
        .post("/api/auth/register")
        .send({ email, password: PASSWORD, passphrase: PASSPHRASE });

    await send("first@iknos.local").expect(201);
    await send("second@iknos.local").expect(409);
    expect((await request(app.getHttpServer()).get("/api/auth/bootstrap")).body.sealed).toBe(true);
  });

  it("lets the database settle a race rather than the route", async () => {
    const app = await buildTestApp({ seeded: false });
    const send = (email: string) =>
      request(app.getHttpServer())
        .post("/api/auth/register")
        .send({ email, password: PASSWORD, passphrase: PASSPHRASE });

    // A `count() === 0` check both requests pass is exactly the race the UNIQUE
    // constraint on `singleton` exists to lose for us.
    const results = await Promise.all([send("a@iknos.local"), send("b@iknos.local")]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(1);
  });

  it("names the short field and never repeats its value", async () => {
    const app = await buildTestApp({ seeded: false });
    const res = await request(app.getHttpServer())
      .post("/api/auth/register")
      .send({ email: "first@iknos.local", password: "hunter2", passphrase: PASSPHRASE })
      .expect(400);

    const body = JSON.stringify(res.body);
    expect(body).toMatch(/password/i);
    expect(body).not.toContain("hunter2");
  });

  it("recovers with the right passphrase and invalidates the old session", async () => {
    const app = await buildTestApp({ seeded: true });
    const cookie = await login(app, "test@iknos.local", "test-password-1234");

    await request(app.getHttpServer())
      .post("/api/auth/recover")
      .send({ email: "test@iknos.local", passphrase: PASSPHRASE, newPassword: "a-brand-new-password" })
      .expect(201);

    await request(app.getHttpServer()).get("/api/me").set("Cookie", cookie).expect(401);
    await login(app, "test@iknos.local", "a-brand-new-password");
  });

  it("answers every recovery failure identically", async () => {
    const app = await buildTestApp({ seeded: true });
    const attempt = (email: string, passphrase: string) =>
      request(app.getHttpServer())
        .post("/api/auth/recover")
        .send({ email, passphrase, newPassword: PASSWORD });

    const wrongPassphrase = await attempt("test@iknos.local", "the wrong passphrase entirely");
    const unknownAccount = await attempt("nobody@iknos.local", PASSPHRASE);

    // Only one account can exist (`singleton`), so the third case is made by
    // emptying the column rather than by seeding a second user.
    await prisma.appUser.update({
      where: { email: "test@iknos.local" },
      data: { recoveryPassphraseHash: null },
    });
    const noPassphraseOnFile = await attempt("test@iknos.local", PASSPHRASE);

    // Three different reasons, one refusal. The route never confirms which.
    for (const res of [unknownAccount, noPassphraseOnFile]) {
      expect(res.status).toBe(wrongPassphrase.status);
      expect(JSON.stringify(res.body)).toBe(JSON.stringify(wrongPassphrase.body));
    }
  });

  it("429s the sixth recovery attempt for that address", async () => {
    const app = await buildTestApp({ seeded: true });
    const attempt = () =>
      request(app.getHttpServer())
        .post("/api/auth/recover")
        .send({ email: "test@iknos.local", passphrase: "wrong passphrase but long", newPassword: PASSWORD });

    // The one failure that is deliberately distinguishable: "try again in
    // fifteen minutes" is useless advice if it reads like "wrong passphrase".
    for (let i = 0; i < 5; i++) await attempt().expect(401);
    await attempt().expect(429);
  });

  it("refuses a password change without the current password or without CSRF", async () => {
    const app = await buildTestApp({ seeded: true });
    const cookie = await login(app, "test@iknos.local", "test-password-1234");
    const { body } = await request(app.getHttpServer()).get("/api/csrf").set("Cookie", cookie);

    await request(app.getHttpServer())
      .post("/api/auth/password")
      .set("Cookie", cookie)
      .set("x-csrf-token", body.csrfToken)
      .send({ currentPassword: "not-the-right-one", newPassword: PASSWORD })
      .expect(401);

    await request(app.getHttpServer())
      .post("/api/auth/password")
      .set("Cookie", cookie)
      .send({ currentPassword: "test-password-1234", newPassword: PASSWORD })
      .expect(403);
  });

  it("keeps the caller's own session alive after a password change", async () => {
    const app = await buildTestApp({ seeded: true });
    const cookie = await login(app, "test@iknos.local", "test-password-1234");
    const { body } = await request(app.getHttpServer()).get("/api/csrf").set("Cookie", cookie);

    await request(app.getHttpServer())
      .post("/api/auth/password")
      .set("Cookie", cookie)
      .set("x-csrf-token", body.csrfToken)
      .send({ currentPassword: "test-password-1234", newPassword: "another-good-password" })
      .expect(201);

    await request(app.getHttpServer()).get("/api/me").set("Cookie", cookie).expect(200);
  });
});
```

Extend `nest-api/test/helpers.ts` with a `login(app, email, password)` returning the cookie, and let `buildTestApp` take `{ seeded }` — `true` truncates `app_user` and inserts `test@iknos.local` with `PASSPHRASE`, `false` truncates and leaves it empty. The seal is a fact about the table, so the fixture has to control the table.

The rate-limit tests need the `iknos:rl:` prefix flushed in `beforeEach`, or a rerun starts already throttled.

- [ ] **Step 7: Run them to verify they fail**

Run: `pnpm test test/account`
Expected: FAIL — all three routes 404.

- [ ] **Step 8: Widen the rate limiter**

`ratelimit.service.ts` — the fixed 5-per-minute becomes a default rather than the only option:

```ts
/** `subject` is an IP for login and an email address for recovery. */
async allow(
  subject: string,
  bucket = "login",
  max = MAX_ATTEMPTS,
  windowSeconds = WINDOW_SECONDS,
): Promise<boolean> {
  const key = `iknos:rl:${bucket}:${subject}`;
  const count = await this.redis.incr(key);
  if (count === 1) await this.redis.expire(key, windowSeconds);
  return count <= max;
}

/** Recovery clears its counter on success, so an owner who fumbled the
 *  passphrase twice before getting it right is not throttled afterwards. */
async clear(subject: string, bucket: string): Promise<void> {
  await this.redis.del(`iknos:rl:${bucket}:${subject}`);
}
```

The default arguments keep the login key identical to Task 10's, so nothing there changes behaviour.

Recovery keys on the **email address**, not the IP, and 5 attempts per fifteen minutes — Zeus's numbers. The trade is deliberate: keying on the address means someone can burn the owner's budget and stall them for a quarter of an hour, but keying on the IP means an attacker with a handful of addresses gets unlimited guesses against a secret that protects the only account. The second is the attack that matters.

- [ ] **Step 8b: Expose the seal**

```ts
/** Public: tells /register whether to show the first-run form or the sealed state. */
@Public()
@Get("bootstrap")
async bootstrap(): Promise<{ sealed: boolean }> {
  return { sealed: (await this.users.count()) > 0 };
}
```

This does leak "somebody has set this instance up", which is why it answers with a boolean and not an address. On a console that already answers `/login`, that is not a secret worth protecting.

- [ ] **Step 9: Implement the controller**

`nest-api/src/auth/account.controller.ts`. `UsersService` gains `count()`, `findById`, `create(email, password, passphrase)` and `setPassword(id, password, passphrase?)`, all hashing with `hashPassword` and all normalising the address (trim, lowercase) before it touches the database — otherwise `Me@…` and `me@…` are two accounts on a table that may only ever hold one.

```ts
const RECOVER_MAX = 5;
const RECOVER_WINDOW_SECONDS = 15 * 60;
const RECOVER_BUCKET = "recover";

@Controller("api/auth")
export class AccountController {
  /** First run only. Seals itself the moment it succeeds. */
  @Public()
  @Post("register")
  async register(@Body() body: RegisterDto) {
    assertLength(body.password, MIN_PASSWORD, "password");
    assertLength(body.passphrase, MIN_PASSPHRASE, "passphrase");

    // Checked here so the ordinary case answers politely…
    if ((await this.users.count()) > 0) {
      throw new ConflictException("this instance already has its account");
    }

    try {
      await this.users.create(body.email, body.password, body.passphrase);
    } catch {
      // …and caught here because that check is a race, and the UNIQUE
      // constraint on `singleton` is the only thing that actually wins it.
      throw new ConflictException("this instance already has its account");
    }

    // No session on purpose: the front lands on /login with "account created —
    // sign in", which proves the password works before it is the only way in.
    return { ok: true };
  }

  @Public()
  @Post("recover")
  async recover(@Body() body: RecoverDto) {
    const email = normaliseEmail(body.email ?? "");

    // Keyed on the address rather than the caller's IP — see Step 8.
    const allowed = await this.rateLimit.allow(
      email, RECOVER_BUCKET, RECOVER_MAX, RECOVER_WINDOW_SECONDS,
    );
    if (!allowed) throw new HttpException("too many attempts", 429);

    assertLength(body.newPassword, MIN_PASSWORD, "password");

    const user = await this.users.findByEmail(email);
    const ok = await verifyPassphrase(user?.recoveryPassphraseHash ?? null, body.passphrase ?? "");
    // One refusal for three different reasons — wrong passphrase, no such
    // account, no passphrase on file. The route never says which it was.
    if (!user || !ok) throw new UnauthorizedException("could not recover");

    await this.users.setPassword(user.id, body.newPassword);
    await this.sessions.destroyForUser(user.id);
    await this.rateLimit.clear(email, RECOVER_BUCKET);

    // No session here either, and for the same reason as register.
    return { ok: true };
  }

  @Post("password")
  async password(@Body() body: PasswordDto, @Req() req) {
    const user = await this.users.findById(req.session.userId);
    const ok = user ? await verifyPassword(body.currentPassword ?? "", user.passwordHash) : false;
    if (!user || !ok) throw new UnauthorizedException();

    assertLength(body.newPassword, MIN_PASSWORD, "password");
    if (body.passphrase !== undefined) assertLength(body.passphrase, MIN_PASSPHRASE, "passphrase");

    // One session per user (Task 8) means there is no other session to destroy
    // here, so the caller's own survives by construction. The last test asserts
    // that property anyway, so it fails loudly the day that rule is relaxed and
    // a stolen session would otherwise outlive the password change.
    await this.users.setPassword(user.id, body.newPassword, body.passphrase);
    return { ok: true };
  }
}
```

`assertLength` throws a plain `Error`; wrap it or convert it to `BadRequestException` at the controller boundary so the exception filter (Task 5) returns 400 rather than 500. A `ValidationPipe` on the DTOs is equally acceptable — the tests hold either way.

- [ ] **Step 10: Extend the user CLI**

`nest-api/scripts/create-account.ts` now prompts for the recovery passphrase too, without echoing, rejecting anything under 20 characters. Skipping it is allowed and prints a warning naming the consequence in full: *this account can only be reset in the database*.

Run against an instance that already has its account, it fails on the `singleton` constraint. Catch that and print *this instance already has its account — use recovery instead* rather than letting a Prisma constraint error reach the terminal.

- [ ] **Step 11: Run the tests to verify they pass**

Run: `pnpm test test/account nest-api/src/auth`
Expected: PASS — 10 endpoint tests, 3 passphrase tests, plus Tasks 8–10's suites still green.

Then from outside, with the server up and an account already created:

```bash
curl -s localhost:4310/api/auth/bootstrap
curl -si -X POST localhost:4310/api/auth/register -H 'content-type: application/json' -d '{}' | head -1
```

Expected: `{"sealed":true}`, then `HTTP/1.1 409 Conflict`.

- [ ] **Step 12: Commit**

```bash
git add nest-api nest-api/src/prisma prisma
git commit -m "feat(auth): gated registration, passphrase recovery and password change"
```

---

## Task 12: Line framing

**Files:**
- Create: `nest-api/src/ingest/line-buffer.ts`, `nest-api/src/ingest/line-buffer.spec.ts`

**Interfaces:**
- Produces: `LineBuffer` with `push(chunk: Buffer)`, `nextLine(): string | null`, `pendingBytes: number`, and `MAX_LINE_BYTES`. Task 14's tailer feeds it; Task 13's parser consumes its output.

The smallest piece of the project and the one most worth getting exactly right. In Rust the type system made this safe for free; in Node it is a convention, so it needs tests.

- [ ] **Step 1: Write the failing test**

`nest-api/src/ingest/line-buffer.spec.ts`:

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

Run: `pnpm test src/ingest/line-buffer`
Expected: FAIL — cannot resolve `./line-buffer`.

- [ ] **Step 3: Implement it**

`nest-api/src/ingest/line-buffer.ts`:

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

Run: `pnpm test src/ingest/line-buffer`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add nest-api/src/ingest
git commit -m "feat(ingest): byte-safe line framing across read boundaries"
```

---

## Task 13: Log line parser

**Files:**
- Create: `nest-api/src/ingest/parser.ts`, `nest-api/src/ingest/parser.spec.ts`, `nest-api/src/ingest/log-record.ts`

**Interfaces:**
- Produces: `LogRecord` (the shape crossing every boundary) and `parse(line: string, service: string, stream: "out" | "err"): LogRecord | null`. `null` means the line was deliberately skipped. Tasks 14 and 17 both carry `LogRecord`.

- [ ] **Step 1: Write the failing test**

`nest-api/src/ingest/parser.spec.ts`:

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

Run: `pnpm test src/ingest/parser`
Expected: FAIL — cannot resolve `./parser`.

- [ ] **Step 3: Define the record type**

`nest-api/src/ingest/log-record.ts`:

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

`nest-api/src/ingest/parser.ts`:

```ts
import type { LogRecord } from "the shared response types";
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

`JSON.parse` here is safe from the event-loop rule because Task 12 caps a line at 1 MB before it ever reaches this function.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test src/ingest`
Expected: PASS, 19 tests.

- [ ] **Step 6: Commit**

```bash
git add nest-api/src/ingest nest-api/src/contracts
git commit -m "feat(ingest): ECS, bare JSON and plain text line parsing"
```

---

## Task 14: Rotation logic and the tailer loop

**Files:**
- Create: `nest-api/src/ingest/rotation.ts`, `nest-api/src/ingest/rotation.spec.ts`, `nest-api/src/ingest/tailer.ts`

**Interfaces:**
- Produces: `decide(stored: StoredOffset | null, now: FileStat): Action` (pure), and `Tailer` with `poll(): Promise<void>`. Task 16 drives `poll` on an interval.

The decision is pulled out as a pure function so every rotation case is testable without a filesystem. The I/O around it stays thin.

- [ ] **Step 1: Write the failing test**

`nest-api/src/ingest/rotation.spec.ts`:

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

Run: `pnpm test src/ingest/rotation`
Expected: FAIL — cannot resolve `./rotation`.

- [ ] **Step 3: Implement the decision**

`nest-api/src/ingest/rotation.ts`:

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

Run: `pnpm test src/ingest/rotation`
Expected: PASS, 7 tests.

- [ ] **Step 5: Implement the tailer**

`nest-api/src/ingest/tailer.ts`:

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

  /** One pass over every matching file. Called on a 1s interval by Task 16. */
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
git add nest-api/src/ingest
git commit -m "feat(ingest): rotation decision and tailer loop"
```

---

## Task 15: Bounded queue and the transactional writer

**Files:**
- Create: `nest-api/src/ingest/writer.ts`, `nest-api/src/ingest/writer.spec.ts`, `nest-api/test/durability.e2e-spec.ts`

**Interfaces:**
- Produces: `Writer` with `submit(chunk: Chunk): void`, `flush(): Promise<void>`, `dropped: number`, and `Chunk = { records: LogRecord[]; offset: OffsetRow }`. Task 16 owns its lifecycle.

- [ ] **Step 1: Write the failing tests**

`nest-api/src/ingest/writer.spec.ts` — backpressure, with no database:

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

`nest-api/test/durability.e2e-spec.ts` — the property that matters, against a real database:

```ts
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "the Prisma client";
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

Run: `pnpm test src/ingest/writer nest-api/test/durability`
Expected: FAIL — cannot resolve `./writer`.

- [ ] **Step 3: Implement it**

`nest-api/src/ingest/writer.ts`:

```ts
import { prisma } from "the Prisma client";
import type { LogRecord } from "the shared response types";
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
  // Read by GET /api/collector/status (Task 21). Held in memory on purpose: a
  // status route that queries MySQL goes silent exactly when MySQL is the
  // problem, which is the one moment anybody looks at it.
  written = 0;
  lastWrittenAt: Date | null = null;

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

Run: `pnpm test src/ingest nest-api/test/durability`
Expected: PASS — 2 backpressure tests, 2 durability tests.

- [ ] **Step 5: Commit**

```bash
git add nest-api
git commit -m "feat(ingest): bounded queue and transactional batch writer"
```

---

## Task 16: Event bus and ingestion lifecycle

**Files:**
- Create: `nest-api/src/stream/log-bus.ts`, `nest-api/src/ingest/ingest.service.ts`, `nest-api/src/ingest/ingest.module.ts`, `nest-api/test/tail-roundtrip.e2e-spec.ts`

**Interfaces:**
- Produces: `LogBus` with `emit(record: LogRecord)` and `subscribe(fn): () => void` (returns an unsubscribe), and `IngestService` implementing `OnApplicationBootstrap` / `OnApplicationShutdown` and exposing `stats(): IngestStats`. Task 19 subscribes to the bus; Task 21 serves `stats()` over HTTP.

`IngestStats` is the snapshot the status route needs, assembled from objects this service already holds — nothing new to plumb through the tailer or the parser:

```ts
export type IngestStats = {
  written: number;
  dropped: number;
  queued: number;
  lastWrittenAt: Date | null;
  files: { filePath: string; byteOffset: number }[];
};
```

Add it as a method on `IngestService`, reading the writer's counters and the tailer's in-memory offset map. **No database query** — see Task 21 for why that constraint is the whole point of the route.

- [ ] **Step 1: Write the failing integration test**

`nest-api/test/tail-roundtrip.e2e-spec.ts`:

```ts
import { randomUUID } from "node:crypto";
import { appendFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prisma } from "the Prisma client";
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

Run: `pnpm test test/tail-roundtrip`
Expected: FAIL — cannot resolve `../src/ingest/ingest.service`.

- [ ] **Step 3: Implement the bus**

`nest-api/src/stream/log-bus.ts`:

```ts
import { Injectable } from "@nestjs/common";
import { EventEmitter } from "node:events";
import type { LogRecord } from "the shared response types";

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

`nest-api/src/ingest/ingest.service.ts`:

```ts
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { prisma } from "the Prisma client";
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

Run: `pnpm test test/tail-roundtrip`
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
git add nest-api
git commit -m "feat(ingest): event bus and ingestion lifecycle"
```

---

## Task 17: Logs query endpoint

**Files:**
- Create: `nest-api/src/logs/cursor.ts`, `nest-api/src/logs/cursor.spec.ts`, `nest-api/src/logs/logs.service.ts`, `nest-api/src/logs/logs.controller.ts`, `nest-api/src/services.controller.ts`, `nest-api/src/logs/log-page.ts`, `nest-api/test/logs.e2e-spec.ts`

**Interfaces:**
- Produces: `GET /api/logs`, `GET /api/services`, and the DTOs `LogRow`, `Service { name: string; pm2Name: string; enabled: boolean }`, `Meta { tookMs: number }` and `LogPage { rows: LogRow[]; nextCursor: string | null; meta: Meta }` in `the shared response types`. Tasks 19, 23, 25, 26, 27 and 28 import those types.

`Meta` is its own exported type rather than an inline shape, because every list response in the project carries one and the status bar renders it the same way regardless of which route produced it.

- [ ] **Step 1: Write the failing tests**

`nest-api/src/logs/cursor.spec.ts`:

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

`nest-api/test/logs.e2e-spec.ts`:

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

Extend `nest-api/test/helpers.ts` with `login(app)` returning the cookie header and `seedLogs(n, message?)` inserting rows under a fresh random service name via `persistBatch`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test src/logs nest-api/test/logs`
Expected: FAIL — `/api/logs` 404s.

- [ ] **Step 3: Implement the cursor**

`nest-api/src/logs/cursor.ts`:

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

`nest-api/src/logs/logs.service.ts` — raw SQL, because optional filters and a composite cursor comparison do not express cleanly through the Prisma API:

```ts
import { Prisma, prisma } from "the Prisma client";

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

`nest-api/src/logs/logs.controller.ts`:

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
    const startedAt = Date.now();

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
      // Measured around the query, not the whole request: the status bar is
      // meant to show when the database is getting slow, not when the network is.
      meta: { tookMs: Date.now() - startedAt },
    };
  }
}
```

Add `GET /api/services` as a plain `prisma.service.findMany({ where: { enabled: true } })`, returning `name`, `pm2Name` and `enabled`. Health state and sparkline series join this response in `IKN-8`; until then the fields are **absent from the payload**, not present and zero — the rail omits what it does not know rather than drawing a flat green line for a service nobody has ever probed.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test src/logs nest-api/test/logs`
Expected: PASS — 2 cursor tests, 5 endpoint tests.

- [ ] **Step 7: Confirm partition pruning actually happens**

Run:

```bash
mysql iknos -e "EXPLAIN SELECT id FROM log_entry WHERE ts >= '2026-08-09 00:00:00' AND ts < '2026-08-10 00:00:00'\G" | grep -i partitions
```

Expected: a single named partition. If every partition is listed, the range predicate is not pruning and that must be fixed before this ships — the whole schema rests on it.

- [ ] **Step 8: Commit**

```bash
git add nest-api nest-api/src/contracts
git commit -m "feat(api): logs search with keyset pagination"
```

---

## Task 18: Histogram and trace endpoints

**Files:**
- Create: `nest-api/src/logs/histogram.service.ts`, `nest-api/src/logs/histogram.service.spec.ts`, `nest-api/src/logs/trace.service.ts`, `nest-api/src/contracts/histogram.ts`, `nest-api/src/contracts/trace.ts`
- Modify: `nest-api/src/logs/logs.controller.ts`, `nest-api/test/logs.e2e-spec.ts`

**Interfaces:**
- Consumes: the filter parsing and the `from`/`to` guard from Task 17, unchanged and shared rather than copied.
- Produces: `GET /api/logs/histogram` → `Histogram { bucketMs: number; buckets: Bucket[]; meta: Meta }` with `Bucket = { t: string; error: number; warn: number; info: number }`, and `GET /api/logs/trace/:traceId` → `Trace { rows: LogRow[]; totalMs: number; meta: Meta }`. Task 26 draws the histogram, Task 28 the timeline.

- [ ] **Step 1: Write the failing bucket-size test**

The one piece of real logic here is choosing a bucket size, and it is pure, so it gets tested without a database.

`nest-api/src/logs/histogram.service.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MAX_BUCKETS, chooseBucketMs } from "./histogram.service";

const span = (ms: number) => chooseBucketMs(0, ms);

describe("chooseBucketMs", () => {
  it("gives a minute per bucket over an hour", () => {
    expect(span(60 * 60_000)).toBe(60_000);
  });

  it("gives an hour per bucket over a day", () => {
    expect(span(24 * 60 * 60_000)).toBe(3_600_000);
  });

  it("never exceeds the ceiling, whatever the range", () => {
    for (const ms of [1_000, 900_000, 3_600_000, 86_400_000, 604_800_000, 10 * 365 * 86_400_000]) {
      expect(Math.ceil(ms / chooseBucketMs(0, ms))).toBeLessThanOrEqual(MAX_BUCKETS);
    }
  });

  it("never returns zero or a negative size for a degenerate range", () => {
    expect(chooseBucketMs(0, 0)).toBeGreaterThan(0);
    expect(chooseBucketMs(500, 0)).toBeGreaterThan(0);
  });
});
```

The third test is the one that matters. A client asking for a week in one-second buckets would ask the database for six hundred thousand rows and the browser to draw them — the server, not the caller, decides granularity.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test src/logs/histogram`
Expected: FAIL — cannot resolve `./histogram.service`.

- [ ] **Step 3: Implement the bucket sizing**

`nest-api/src/logs/histogram.service.ts`:

```ts
export const MAX_BUCKETS = 60;

const STEPS_MS = [
  1_000, 5_000, 15_000, 60_000, 300_000, 900_000, 3_600_000, 21_600_000, 86_400_000,
];

/** Smallest round step that keeps the bucket count within the ceiling. */
export function chooseBucketMs(fromMs: number, toMs: number): number {
  const span = Math.max(toMs - fromMs, 1);
  const fit = STEPS_MS.find((step) => span / step <= MAX_BUCKETS);
  // Past the largest round step, stop being pretty and just divide. The ceiling
  // is a guarantee; round numbers on the axis are only a preference.
  return fit ?? Math.ceil(span / MAX_BUCKETS);
}
```

- [ ] **Step 4: Write the query**

Same `WHERE` clause as Task 17 — same filters, same mandatory window, same bound parameters — with the grouping added:

```sql
SELECT FLOOR(TIMESTAMPDIFF(MICROSECOND, ?, ts) / ?) AS bucket,
       SUM(level >= 50) AS error,
       SUM(level  = 40) AS warn,
       SUM(level  < 40) AS info
  FROM log_entry
 WHERE ts >= ? AND ts < ?   -- plus the optional filters
 GROUP BY bucket
 ORDER BY bucket
```

Two details worth stating rather than discovering:

- The bucket expression uses `TIMESTAMPDIFF` from `from`, not `UNIX_TIMESTAMP(ts)`. The latter interprets a `DATETIME` in the session time zone, so the same query would bucket differently depending on who connected. `TIMESTAMPDIFF` is an exact offset and has no time zone at all.
- Wrapping `ts` in a function in the `SELECT`/`GROUP BY` does **not** defeat partition pruning, because pruning is decided by the `WHERE` clause, which still compares the bare column. Step 7 verifies that rather than trusting it.

Empty buckets are filled in by the service, not by SQL: a range with no logs must return a flat row of zeroes, not a shorter array. The chart's x-axis has to stay the range the user asked for.

Levels follow pino: `error` is 50 and above, so `fatal` is counted as an error rather than silently dropped.

- [ ] **Step 5: Write the trace endpoint**

`nest-api/src/logs/trace.service.ts` — every row sharing a `trace.id`, in `ts` order, with `duration_ms`:

```ts
const TRACE_ID = /^[0-9a-f]{1,32}$/i;

async byTraceId(traceId: string, from: Date, to: Date): Promise<Trace> {
  // Reject the shape before it reaches the query. The value is bound either
  // way, but a 400 on obvious garbage beats an index scan that finds nothing.
  if (!TRACE_ID.test(traceId)) throw new BadRequestException("malformed trace id");

  const rows = await this.prisma.$queryRaw<Row[]>`
    SELECT id, ts, service, level, level_name, message, route, http_method,
           status_code, duration_ms, trace_id
      FROM log_entry
     WHERE trace_id = ${traceId} AND ts >= ${from} AND ts < ${to}
     ORDER BY ts ASC
     LIMIT 500`;
  ...
}
```

Bounded like everything else, and for the same reason: `(trace_id, ts)` is indexed, but an unbounded lookup of an id that appears nowhere still walks the whole index across every partition.

`totalMs` spans the first row's `ts` to the last row's `ts` plus its `duration_ms` — the wall-clock length of the request as the logs recorded it. This is not a span tree and must not be described as one anywhere in the response.

- [ ] **Step 6: Add the endpoint tests**

Append to `nest-api/test/logs.e2e-spec.ts`:

```ts
it("rejects a histogram request with no window", async () => {
  await request(app.getHttpServer()).get("/api/logs/histogram").expect(400);
});

it("returns buckets that total the same as the search", async () => {
  const window = `from=${from}&to=${to}&service=pfa-api`;
  const hist = await request(app.getHttpServer()).get(`/api/logs/histogram?${window}`).expect(200);
  const total = hist.body.buckets.reduce(
    (n: number, b: Bucket) => n + b.error + b.warn + b.info, 0,
  );

  expect(total).toBe(KNOWN_ROW_COUNT_FOR_THAT_WINDOW);
});

it("keeps the bucket count bounded over a week", async () => {
  const res = await request(app.getHttpServer())
    .get(`/api/logs/histogram?from=${weekAgo}&to=${to}`).expect(200);
  expect(res.body.buckets.length).toBeLessThanOrEqual(60);
});

it("returns a trace in timestamp order", async () => {
  const res = await request(app.getHttpServer())
    .get(`/api/logs/trace/${KNOWN_TRACE_ID}?from=${from}&to=${to}`).expect(200);

  const times = res.body.rows.map((r: LogRow) => r.ts);
  expect(times).toEqual([...times].sort());
  expect(res.body.totalMs).toBeGreaterThan(0);
});

it("400s a malformed trace id and 200s an unknown one", async () => {
  await request(app.getHttpServer())
    .get(`/api/logs/trace/not-a-trace-id!?from=${from}&to=${to}`).expect(400);

  const res = await request(app.getHttpServer())
    .get(`/api/logs/trace/deadbeef?from=${from}&to=${to}`).expect(200);
  expect(res.body.rows).toEqual([]);
});
```

An unknown trace id is an empty result, not a 404: the caller asked a well-formed question and the answer is "nothing", which is information.

- [ ] **Step 7: Confirm pruning survives the GROUP BY**

```bash
mysql iknos -e "EXPLAIN SELECT FLOOR(TIMESTAMPDIFF(MICROSECOND,'2026-08-09 00:00:00', ts)/60000000) b, COUNT(*) FROM log_entry WHERE ts >= '2026-08-09 00:00:00' AND ts < '2026-08-10 00:00:00' GROUP BY b\G"
```

Expected: the `partitions` column lists one partition, not all of them. If it lists all of them, the `WHERE` clause has been altered somewhere into a form MySQL cannot prune on — fix that before moving on, because this query runs on every page load.

- [ ] **Step 8: Run the tests**

Run: `pnpm test src/logs nest-api/test/logs`
Expected: PASS — 4 bucket tests, 2 cursor tests, 10 endpoint tests.

- [ ] **Step 9: Commit**

```bash
git add nest-api/src/logs nest-api/src/contracts nest-api/test
git commit -m "feat(api): log volume histogram and trace timeline endpoints"
```

---

## Task 19: Live tail over SSE

**Files:**
- Create: `nest-api/src/stream/stream.controller.ts`, `nest-api/test/stream.e2e-spec.ts`

**Interfaces:**
- Produces: `GET /api/logs/stream`, emitting `log` events whose payload is a `LogRow` — the same shape `GET /api/logs` returns, so the front end needs one row renderer.

- [ ] **Step 1: Write the failing test**

`nest-api/test/stream.e2e-spec.ts`:

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

Run: `pnpm test test/stream`
Expected: FAIL — 404.

- [ ] **Step 3: Implement it**

Written against the raw response rather than Nest's `@Sse()` decorator. `@Sse()` is tidier, but it gives no access to the socket's buffered length — and without that the "a slow subscriber must not retain memory" requirement cannot actually be met, only hoped for.

`nest-api/src/stream/stream.controller.ts`:

```ts
import { BadRequestException, Controller, Get, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import type { LogRecord } from "the shared response types";
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
      // Belt and braces with nginx's proxy_buffering off (Task 31).
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

Run: `pnpm test test/stream`
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
git add nest-api
git commit -m "feat(api): live tail over server-sent events"
```

---

## Task 20: Partition maintenance and retention

**Files:**
- Create: `nest-api/src/maintenance/partitions.ts`, `nest-api/src/maintenance/partitions.spec.ts`, `nest-api/src/maintenance/maintenance.service.ts`, `nest-api/test/maintenance.e2e-spec.ts`

**Interfaces:**
- Produces: `plan(existing: string[], today: Date, retentionDays: number, daysAhead: number): Plan` (pure) and `MaintenanceService` running it at boot and daily, exposing `window(): { retentionDays: number; oldestPartition: string | null; lastRunAt: Date | null }`. Task 21 serves that over HTTP.

The planning is pure so the date arithmetic — the part that is genuinely easy to get wrong — is tested without a database.

`window()` exists because a retention policy nobody can check from the interface is a retention policy nobody trusts. It is three fields the service already has in hand after each run.

- [ ] **Step 1: Write the failing test**

`nest-api/src/maintenance/partitions.spec.ts`:

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

Run: `pnpm test src/maintenance`
Expected: FAIL — cannot resolve `./partitions`.

- [ ] **Step 3: Implement planning**

`nest-api/src/maintenance/partitions.ts`:

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

Run: `pnpm test src/maintenance`
Expected: PASS, 6 tests.

- [ ] **Step 5: Implement the scheduled job**

`nest-api/src/maintenance/maintenance.service.ts`, using `@nestjs/schedule`:

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

`nest-api/test/maintenance.e2e-spec.ts` — run the job twice, assert the second is a no-op, then insert a row for today and assert it still succeeds. Re-running must never duplicate a partition or leave the table unwritable.

- [ ] **Step 7: Verify the disk claim rather than trusting it**

```bash
mysql iknos -e "SELECT PARTITION_NAME, TABLE_ROWS, DATA_LENGTH FROM information_schema.PARTITIONS WHERE TABLE_NAME='log_entry'"
```

Expected: one row per day plus `p_future`, and sizes that go to nothing after a drop.

- [ ] **Step 8: Commit**

```bash
git add nest-api
git commit -m "feat(maintenance): daily partition window and retention"
```

---

## Task 21: Collector status and storage endpoints

**Files:**
- Create: `nest-api/src/collector/collector.controller.ts`, `nest-api/src/collector/ingest-rate.service.ts`, `nest-api/src/collector/storage.service.ts`, `nest-api/src/collector/storage.service.spec.ts`, `nest-api/src/contracts/collector.ts`, `nest-api/test/collector.e2e-spec.ts`

**Interfaces:**
- Consumes: `IngestService.stats()` (Task 16) and `MaintenanceService.window()` (Task 20).
- Produces: `GET /api/collector/status` → `CollectorStatus` and `GET /api/collector/storage` → `Storage`. Task 30 renders both.

`nest-api/src/contracts/collector.ts`:

```ts
export type CollectorStatus = {
  /** null, never 0, when nothing has been written yet. */
  lagMs: number | null;
  written: number;
  dropped: number;
  queued: number;
  perMinute: number[];
  files: { filePath: string; byteOffset: number }[];
};

export type Storage = {
  tables: { name: string; bytes: number; retentionDays: number | null }[];
  oldestPartition: string | null;
  diskFreeBytes: number;
  diskTotalBytes: number;
  lastRunAt: string | null;
};
```

This is Iknos watching itself, which is the claim the whole project rests on. A collector that cannot say whether it is keeping up is a blind spot in the one place that cannot afford one.

- [ ] **Step 1: Write the failing tests**

`nest-api/src/collector/storage.service.spec.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { StorageService } from "./storage.service";
import { lagMsFrom } from "./collector.controller";

const statfs = async () => ({ bsize: 4096, blocks: 1000, bfree: 400 });

describe("StorageService", () => {
  it("does not query information_schema twice inside the cache window", async () => {
    const query = vi.fn().mockResolvedValue([{ name: "log_entry", bytes: 1024n }]);
    const svc = new StorageService({ $queryRaw: query } as never, statfs as never);

    await svc.read();
    await svc.read();

    // information_schema is not free on a partitioned table, and this panel has
    // no reason whatsoever to be fresh to the second.
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("returns byte counts as numbers, not BigInt", async () => {
    const query = vi.fn().mockResolvedValue([{ name: "log_entry", bytes: 1024n }]);
    const svc = new StorageService({ $queryRaw: query } as never, statfs as never);

    // BigInt reaching JSON.stringify throws, exactly as in Task 7.
    expect(() => JSON.stringify(svc)).not.toThrow();
    const out = await svc.read();
    expect(typeof out.tables[0].bytes).toBe("number");
  });
});

describe("lagMsFrom", () => {
  it("reports null on a cold start rather than zero", () => {
    // Zero means "perfectly up to date". Nothing-written-yet means "I don't
    // know". Collapsing the two is how a dead collector looks healthy.
    expect(lagMsFrom(null, new Date())).toBeNull();
  });

  it("reports the distance from the last written line", () => {
    const now = new Date("2026-08-09T12:00:10.000Z");
    expect(lagMsFrom(new Date("2026-08-09T12:00:00.000Z"), now)).toBe(10_000);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test src/collector`
Expected: FAIL — cannot resolve `./storage.service`.

- [ ] **Step 3: Implement the storage read**

`nest-api/src/collector/storage.service.ts`:

```ts
import { statfs } from "node:fs/promises";
import { Injectable } from "@nestjs/common";

const CACHE_MS = 5 * 60_000;

@Injectable()
export class StorageService {
  private cached: { at: number; value: Storage } | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly fsStat = statfs,
  ) {}

  async read(): Promise<Storage> {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.value;

    const rows = await this.prisma.$queryRaw<{ name: string; bytes: bigint }[]>`
      SELECT table_name AS name, data_length + index_length AS bytes
        FROM information_schema.TABLES
       WHERE table_schema = DATABASE()`;

    const fs = await this.fsStat("/");
    const value: Storage = {
      // Number() at the boundary, once. Task 7 decided not to patch BigInt
      // globally, so every crossing point converts explicitly.
      tables: rows.map((r) => ({ name: r.name, bytes: Number(r.bytes), retentionDays: null })),
      oldestPartition: null,
      diskFreeBytes: fs.bsize * fs.bfree,
      diskTotalBytes: fs.bsize * fs.blocks,
      lastRunAt: null,
    };

    this.cached = { at: Date.now(), value };
    return value;
  }
}
```

The controller fills `retentionDays`, `oldestPartition` and `lastRunAt` from `MaintenanceService.window()` — those are already in memory and must not be cached alongside the expensive part.

- [ ] **Step 4: Sample the ingest rate**

The writer counts totals; the sparkline needs a series. One sampler owns that, and nothing else changes:

```ts
@Injectable()
export class IngestRateService {
  private readonly minutes: number[] = [];
  private lastTotal = 0;

  constructor(private readonly ingest: IngestService) {}

  @Interval(60_000)
  sample(): void {
    const { written } = this.ingest.stats();
    this.minutes.push(written - this.lastTotal);
    this.lastTotal = written;
    if (this.minutes.length > 60) this.minutes.shift();
  }

  /** Shorter than 60 after a restart, and that is the honest answer. The card
   *  draws what exists rather than padding the left with zeroes that would read
   *  as "no traffic an hour ago". */
  get perMinute(): number[] {
    return [...this.minutes];
  }
}
```

- [ ] **Step 5: Write the controller**

Both routes sit behind the global guard, like everything else. `status` reads **only** from memory — `IngestService.stats()` and `IngestRateService` — and issues no query at all:

```ts
export function lagMsFrom(lastWrittenAt: Date | null, now: Date): number | null {
  return lastWrittenAt === null ? null : now.getTime() - lastWrittenAt.getTime();
}
```

That constraint is the entire point of the route. A status endpoint that queries MySQL goes quiet precisely when MySQL is the problem, which is the only moment anyone opens it.

- [ ] **Step 6: Add the endpoint tests**

`nest-api/test/collector.e2e-spec.ts` — both routes 401 without a cookie; with a session, `status` responds while the database is stopped:

```ts
it("still answers when every database call fails", async () => {
  // Log in against a healthy app first. Sessions live in Redis and the guard
  // never touches MySQL, so this cookie stays valid against an app whose
  // database is gone — which is itself the property being relied on here.
  const healthy = await buildTestApp();
  const cookie = await login(healthy, "test@iknos.local", "test-password-1234");

  // Overriding the client is deterministic and needs no control over the MySQL
  // service. If the status route ever grows a query, this goes red — instead of
  // the pill going blank during the very outage it exists to report.
  const dead = {
    $queryRaw: () => Promise.reject(new Error("ECONNREFUSED")),
    $executeRawUnsafe: () => Promise.reject(new Error("ECONNREFUSED")),
    appUser: { findUnique: () => Promise.reject(new Error("ECONNREFUSED")) },
  };
  const app = await buildTestApp({ prisma: dead });

  const res = await request(app.getHttpServer())
    .get("/api/collector/status").set("Cookie", cookie).expect(200);

  expect(res.body).toHaveProperty("lagMs");

  // And the contrast that proves the stub is really in the way.
  await request(app.getHttpServer())
    .get(`/api/logs?from=${from}&to=${to}`).set("Cookie", cookie).expect(500);
});
```

`buildTestApp` gains an optional `prisma` override alongside the `seeded` one from Task 11 — a stub swapped in through the Nest testing module's `overrideProvider`. Both apps must share one Redis, which they do by default.

Do not skip this test. It is the single behaviour this route exists for.

- [ ] **Step 7: Run the tests**

Run: `pnpm test src/collector nest-api/test/collector`
Expected: PASS — 4 unit tests, 3 endpoint tests.

- [ ] **Step 8: Commit**

```bash
git add nest-api/src/collector nest-api/src/contracts nest-api/test
git commit -m "feat(api): collector status and storage endpoints"
```

---

## Task 22: Next app, Iknos tokens and primitives

**Files:**
- Create: `front/` (Next App Router), `front/src/styles/tokens.css`, `front/src/styles/globals.css`, `front/src/styles/tokens.test.ts`, `front/src/lib/api.ts`, `front/src/components/ui/*`

**Interfaces:**
- Produces: the token layer, the M1 primitives, and `apiGet<T>(path)` / `apiMutate(path, body)`. Tasks 23 through 30 use only these.

The design system is **not** a port of PFA's appearance. The exploration behind the mockup rejected it explicitly — *"zéro dégradé, monospace partout où il y a de la donnée"* — so `GlowCard` and its gradient rule do not survive. What is copied from PFA is the *architecture*: the `globals.css` split, the token layer, `nuqs` for URL state, the primitive inventory. See `docs/superpowers/specs/2026-08-09-iknos-ui-design.md` §3.

- [ ] **Step 1: Scaffold**

```bash
pnpm create next-app@latest front --ts --app --tailwind --eslint=false --src-dir --import-alias '@/*'
```

Delete the generated page and CSS so nothing from the template survives.

- [ ] **Step 2: Write the failing token test**

`front/src/styles/tokens.test.ts`:

```ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");

function declaredVars(selector: string): string[] {
  const block = css.split(selector)[1]?.split("}")[0] ?? "";
  return [...block.matchAll(/--ikn-[\w-]+/g)].map((m) => m[0]).sort();
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : [];
  });
}

describe("token layer", () => {
  it("declares the same variables on every surface", () => {
    // The classic failure: a colour gets added to the dark ramp, the light one
    // silently inherits nothing, and one component renders invisible text.
    const chassis = declaredVars('[data-surface="chassis"]');
    const work = declaredVars('[data-surface="work"]');

    expect(chassis.length).toBeGreaterThan(10);
    expect(work).toEqual(chassis);
  });

  it("has no bare hex colour in any component", () => {
    const offenders = walk("src")
      .filter((f) => /#[0-9a-fA-F]{3,8}\b/.test(readFileSync(f, "utf8")));

    expect(offenders).toEqual([]);
  });
});
```

The second test turns a global constraint into something that fails a build instead of a review.

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter web vitest run src/styles/tokens.test.ts`
Expected: FAIL — `tokens.css` does not exist.

- [ ] **Step 4: Write the token layer**

`front/src/styles/tokens.css` — three surfaces, the same variable names on each. A component never names a colour; it names a role, and the surface it is mounted on decides the value.

```css
/* Chassis: the tool. Bars, rail, status line, modals, auth. Never moves. */
[data-surface="chassis"] {
  --ikn-bg:            #171E27;
  --ikn-bg-inset:      #0C1117;
  --ikn-bg-raised:     #1E2733;
  --ikn-border:        #27313D;
  --ikn-border-strong: #33404E;
  --ikn-border-focus:  #4A5F72;
  --ikn-fg:            #CBD8D0;
  --ikn-fg-muted:      #8FA99A;
  --ikn-fg-dim:        #5E7286;
  --ikn-accent:        #86B99A;
  --ikn-warn:          #E0AE55;
  --ikn-error:         #E4736B;
  --ikn-info:          #7FA8C4;
  --ikn-error-bg:      #22191C;
}

/* Work surface: the data you read for an hour at a time. */
[data-surface="work"] {
  --ikn-bg:            #BFCDD4;
  --ikn-bg-inset:      #AEBFC7;
  --ikn-bg-raised:     #BFCDD4;
  --ikn-border:        #93A8B3;
  --ikn-border-strong: #A3B6BF;
  --ikn-border-focus:  #556A76;
  --ikn-fg:            #131E24;
  --ikn-fg-muted:      #3F535F;
  --ikn-fg-dim:        #556A76;
  --ikn-accent:        #3C6B52;
  --ikn-warn:          #8A6118;
  --ikn-error:         #8E2F2A;
  --ikn-info:          #4E7B96;
  --ikn-error-bg:      #C4A9A6;
}

/* Terminal: the log window, inset into the work surface. */
[data-surface="terminal"] {
  --ikn-bg:            #10151C;
  --ikn-bg-inset:      #0C1117;
  --ikn-bg-raised:     #171E27;
  --ikn-border:        #1B242E;
  --ikn-border-strong: #24303C;
  --ikn-border-focus:  #4A5F72;
  --ikn-fg:            #DFE9E4;
  --ikn-fg-muted:      #AFC0BA;
  --ikn-fg-dim:        #55697C;
  --ikn-accent:        #86B99A;
  --ikn-warn:          #E0AE55;
  --ikn-error:         #E4736B;
  --ikn-info:          #7FA8C4;
  --ikn-error-bg:      #22191C;
}
```

Expose them to Tailwind v4 with `@theme { --color-ikn-bg: var(--ikn-bg); … }` so `bg-ikn-bg` works and no component ever needs a bracket.

Fonts: **JetBrains Mono** for anything that is data or chrome, **IBM Plex Sans** for card titles and prose. The mockup also loads IBM Plex Mono without using it — drop it, three families for two jobs is page weight with no return.

Green is the identity, not "everything is fine". It is why the exploration discarded the navy direction. No chart may use `--ikn-accent` as a neutral series colour.

- [ ] **Step 5: Build the primitives**

Only what M1 needs: card, button, text field, select, filter chip, status badge, dense table, pill, tooltip, modal shell (tag, title, `esc`, body, hint line, actions), toast, and the time-range control with its `nuqs` URL state.

Plus **sparkline** — the one dataviz primitive M1 needs, for the service rail and the ingest card. Line and bar charts wait for `IKN-13` and `IKN-23`; porting them now would be dead code.

A card is a 1px border and a flat fill. It never floats on a shadow. Elevation belongs to things that overlay: modals, the user menu, toasts. Density is a single prop, `compact` (default) or `comfortable`, and it changes row padding and nothing else.

- [ ] **Step 6: Write the API client**

`front/src/lib/api.ts`:

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

Client calls use relative paths so they reach nginx on the same origin — which is what makes the cookie and the CSRF header work with no CORS configuration at all.

- [ ] **Step 7: Run the tests and build**

Run: `pnpm --filter web vitest run && pnpm --filter web build`
Expected: PASS, 2 token tests; build succeeds; types resolve against `the shared response types`.

- [ ] **Step 8: Commit**

```bash
git add front
git commit -m "feat(web): iknos token layer, primitives and api client"
```

---

## Task 23: The app chassis — top bar, service rail, status bar

**Files:**
- Create: `front/src/app/(app)/layout.tsx`, `front/src/components/chrome/top-bar.tsx`, `service-rail.tsx`, `status-bar.tsx`, `user-menu.tsx`, `views.ts`, `front/src/components/chrome/views.test.ts`

**Interfaces:**
- Consumes: `apiGet` (Task 22), `GET /api/services` (Task 17).
- Produces: the chassis every later task renders inside, the selected service in the route, and the global time range in the URL. Tasks 25 through 30 add panels, never chrome.

The chassis ships **whole** in M1 even though most of its views arrive later. Retrofitting a service rail into a finished page is far more expensive than building around one from the start.

- [ ] **Step 1: Write the failing view-list test**

`front/src/components/chrome/views.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { VIEWS } from "./views";

describe("VIEWS", () => {
  it("lists only views that can actually answer", () => {
    // No greyed-out entries, no "coming in M2". An interface that advertises
    // five views and delivers one teaches you to stop trusting the other four.
    expect(VIEWS.map((v) => v.key)).toEqual(["logs"]);
  });

  it("gives every view a unique shortcut", () => {
    const keys = VIEWS.map((v) => v.badge);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
```

- [ ] **Step 2: Run it to verify it fails, then implement**

Run: `pnpm --filter web vitest run src/components/chrome`
Expected: FAIL, then PASS once `views.ts` exists:

```ts
export type View = { key: string; label: string; badge: string };

/**
 * M1 ships one view. `service`, `metrics`, `issues` and `alerts` are appended
 * here by IKN-13, IKN-23, IKN-14 and IKN-15 — each one when its data exists,
 * never before. Update the test in the same commit that adds one.
 */
export const VIEWS: readonly View[] = [{ key: "logs", label: "logs", badge: "L" }];
```

- [ ] **Step 3: Route by service**

`front/src/app/(app)/[service]/[view]/page.tsx`. The selected service is a path segment, not component state: it must survive a reload, a shared link and the browser's back button, and every panel on screen is scoped to it.

The layout is a server component that calls `apiGet<Service[]>("/api/services")` once and hands the list to the rail. One request for the whole rail, not one per row — the rail is on every screen and a per-row request would be paid forever.

- [ ] **Step 4: Build the three pieces of chrome**

**Top bar** — brand, the `ks-b` host badge, the `services / {service}` breadcrumb, the ⌘K trigger (wired in Task 29), the global range selector `15m · 1h · 24h · 7d` in the URL via `nuqs`, the collector pill (Task 30), and a clock.

**Service rail** — one row per service: status dot, name, sparkline. Services with no health data yet render the name alone; the dot and sparkline are simply absent, because `GET /api/services` omits those fields until `IKN-8` (Task 17, step 5). Below the list: the view list, the ingest card (Task 30), the user menu.

**Status bar** — mode, service, tail state, event count, query time, active-alert count, and the permanent keyboard legend. Task 29 fills the last four; the bar exists now so nothing has to reflow later.

**User menu** — signed-in email, `settings` (toasts "not in v1 scope", exactly as the mockup does), `change password` and `set recovery passphrase` (both live, Task 24), and log out.

`data-surface` is set once per region: `chassis` on the bars and rail, `work` on the main column. That single attribute is what makes the two token ramps resolve correctly, so it must never be set on an individual component.

- [ ] **Step 5: Verify the frame by hand**

At 1440×900 with the logs view open:

- the page itself does not scroll — `document.body.scrollHeight <= window.innerHeight` in the console;
- only the log list scrolls, inside its own box;
- shrinking the window collapses the rail without breaking the status bar;
- every colour on screen resolves from a token (spot-check in devtools that no computed colour comes from an inline hex).

- [ ] **Step 6: Commit**

```bash
git add front
git commit -m "feat(web): app chassis with service rail and status bar"
```

---

## Task 24: Auth screens — login, register, recover, about

**Files:**
- Create: `front/src/app/(auth)/login/page.tsx`, `register/page.tsx`, `recover/page.tsx`, `about/page.tsx`, `front/src/app/(auth)/auth-shell.tsx`, `front/src/lib/bootstrap.ts`, `front/src/lib/bootstrap.test.ts`, `front/src/middleware.ts`

**Interfaces:**
- Consumes: `GET /api/auth/bootstrap` (Task 11), `POST /api/auth/login` (Task 10), `register` / `recover` / `password` (Task 11).
- Produces: a working way in, and a working way back in.

- [ ] **Step 1: Read the seal, on the server**

The route already exists (Task 11, Step 8b). The front side follows worldweathr's `getPublicConfig` shape — React `cache()` so a layout and a page share one request per render, a schema-validated body, and a defined answer when the API will not give one.

`front/src/lib/bootstrap.ts`:

```ts
import { cache } from "react";
import { z } from "zod";

const BootstrapSchema = z.object({ sealed: z.boolean() });

/**
 * What we assume when the API will not answer. Sealed, because that is the
 * normal state of a deployed instance and the two mistakes are not equal:
 * wrongly showing the seal on a fresh instance costs nothing — first-run setup
 * is documented as `pnpm seed:user` anyway — while wrongly showing an open
 * first-run form on a live console invites someone to try to take it over.
 *
 * The API refuses either way, so this is only ever cosmetic. It should still be
 * cosmetic in the safe direction.
 */
const SEALED = { sealed: true };

export const getBootstrap = cache(async (): Promise<{ sealed: boolean }> => {
  try {
    const res = await fetch(`${API_BASE}/api/auth/bootstrap`, { cache: "no-store" });
    if (!res.ok) return SEALED;

    const parsed = BootstrapSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : SEALED;
  } catch {
    return SEALED;
  }
});
```

`bootstrap.test.ts` covers the three ways the API can fail to answer — unreachable, non-OK, wrong shape — and asserts `sealed: true` for each. Mock the fetch by throwing from inside the implementation rather than with `mockRejectedValue`, which builds the rejected promise at setup time and gets flagged as unhandled before the code under test awaits it.

- [ ] **Step 2: Write the middleware**

`front/src/middleware.ts`:

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
  matcher: ["/((?!login|register|recover|about|_next/static|_next/image|favicon.ico).*)"],
};
```

The three new public pages join `login` in the exclusion list. Forgetting one produces a redirect loop on the page whose entire purpose is recovering an account you cannot log into.

- [ ] **Step 3: Build the shared shell**

`auth-shell.tsx` — full-screen `data-surface="chassis"`, the oversized outlined `IKNOS` wordmark bled off the bottom-left, two radial washes, a chrome bar carrying `KS-B.INTERNAL` with a liveness dot, and the footer: the product line, an `ABOUT IKNOS →` link, and `httpOnly cookie · rolling session · CSRF · scrypt`.

Stating the security posture on the login screen of a self-hosted tool is honest and costs one line.

- [ ] **Step 4: Build login**

A client component posting to `/api/auth/login` with `credentials: "same-origin"`. Login carries no CSRF token — there is no session yet to mint one from, and `SameSite=Lax` is what protects it.

Three states, exactly:

```tsx
if (res.status === 429) {
  setError("Trop de tentatives. Réessayez dans une minute.");
} else if (!res.ok) {
  // Deliberately identical for unknown account and wrong password.
  setError("Identifiants invalides.");
} else {
  router.replace("/pfa-api/logs");
}
```

- [ ] **Step 5: Build register, with its sealed state**

A server component calls `getBootstrap()`. When `sealed` is true it renders the amber-edged banner — *"this instance already has its account"*, with *"use recovery if you are locked out"* underneath — above the form, with the form at 42% opacity and the button inert.

**Decided on the server, deliberately.** Fetching the seal in the client and hiding the form after mount leaves a window in which a real, submittable first-run form is on screen. Worldweathr's signup page makes the same call for the same reason.

Render the form rather than hiding it. Someone who arrives here needs to see that the instance is already set up, not wonder whether the page is broken.

On a fresh instance: email, password + confirm, a four-segment strength meter, recovery passphrase + confirm (20+ characters), and the warning in full — *the only way back in if you lose your password; there is no recovery email; write it down.*

On success the API opens no session, so the page redirects to `/login` with *"account created — sign in"*. That is not a missing feature: signing in immediately proves the password works while the passphrase is still on screen to be written down.

The mockup's banner names an environment variable (`IKNOS_ALLOW_SIGNUP=false`). There is no such variable — the seal is the account's existence — so the copy changes. The mockup is authoritative on form, not on values.

- [ ] **Step 6: Build recover and about**

`recover` — email, recovery passphrase, new password + confirm, posting to `/api/auth/recover`. On success, redirect to login with a toast; the API has already destroyed every session.

`about` — the legal notice as a key/value list, reachable from the footer of all three.

- [ ] **Step 7: Verify by hand**

- Empty submit blocked client-side; wrong credentials give the generic message; six fast attempts give the 429 message; correct credentials land on the logs view.
- With an account present, `/register` shows the sealed banner and the button does nothing.
- Against an empty `app_user`, registration creates the account and lands on `/login`, where the new password works.
- Stopping the API and reloading `/register` still shows the seal, not an open form.
- Recovery with the right passphrase works; with a wrong one, the message is identical to an account that has no passphrase at all.
- `/recover` is reachable while logged out — the redirect-loop check.

Cookie flags are verified in Task 31 against the deployed environment: `Secure` requires real HTTPS and cannot be observed on `localhost`.

- [ ] **Step 8: Commit**

```bash
git add front nest-api/src/auth
git commit -m "feat(web): login, gated registration, recovery and legal screens"
```

---

## Task 25: Logs panel — query tokens, table and pagination

**Files:**
- Create: `front/src/lib/log-query.ts`, `front/src/lib/log-query.test.ts`, `front/src/components/logs/log-panel.tsx`, `query-bar.tsx`, `log-table.tsx`, `log-row.tsx`

**Interfaces:**
- Produces: `buildLogQuery(params: URLSearchParams, now?: Date): string` — the single place UI state becomes an API query. Tasks 26, 27 and 28 all reuse it, so search, histogram and live tail cannot drift apart.

- [ ] **Step 1: Write the failing query-builder test**

`front/src/lib/log-query.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildLogQuery } from "./log-query";

const q = (init: Record<string, string> = {}, now?: Date) =>
  new URLSearchParams(buildLogQuery(new URLSearchParams(init), now));

describe("buildLogQuery", () => {
  it("always emits from and to", () => {
    expect(q().get("from")).toBeTruthy();
    expect(q().get("to")).toBeTruthy();
  });

  it("passes through set filters and omits unset ones", () => {
    const out = q({ service: "pfa-api", q: "/api/users/42" });
    expect(out.get("service")).toBe("pfa-api");
    expect(out.get("q")).toBe("/api/users/42");
    expect(out.has("route")).toBe(false);
  });

  it("honours the selected range", () => {
    const out = q({ range: "24h" }, new Date("2026-08-09T12:00:00.000Z"));
    expect(out.get("from")).toBe("2026-08-08T12:00:00.000Z");
  });

  it("falls back to a sane range rather than emitting an invalid one", () => {
    expect(q({ range: "nonsense" }).get("from")).toBeTruthy();
  });

  it("keeps a switched-off token in the URL but out of the query", () => {
    // This is what lets you look "without the service filter" and get it back
    // with one click instead of retyping it.
    const out = q({ service: "pfa-api", min_level: "warn", off: "service" });
    expect(out.has("service")).toBe(false);
    expect(out.get("min_level")).toBe("warn");
  });

  it("ignores an explicit window in the incoming params", () => {
    // The range control is the only source of from/to. A hand-edited URL must
    // not be able to widen the window past what the control can express.
    const out = q({ from: "1970-01-01T00:00:00.000Z", range: "1h" });
    expect(out.get("from")).not.toBe("1970-01-01T00:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web vitest run src/lib/log-query.test.ts`
Expected: FAIL — cannot resolve `./log-query`.

- [ ] **Step 3: Implement it**

`front/src/lib/log-query.ts`:

```ts
export type Range = "15m" | "1h" | "24h" | "7d";

const MINUTES: Record<Range, number> = { "15m": 15, "1h": 60, "24h": 1440, "7d": 10080 };
const FILTERS = ["service", "min_level", "route", "status", "q"] as const;

export function resolveRange(range: Range, now = new Date()) {
  return {
    from: new Date(now.getTime() - MINUTES[range] * 60_000).toISOString(),
    to: now.toISOString(),
  };
}

/**
 * `from` and `to` are always present and always come from the range control.
 * The API rejects a request without them, so the UI must be structurally
 * incapable of building one — hence a fresh URLSearchParams rather than a copy
 * of the incoming one.
 */
export function buildLogQuery(params: URLSearchParams, now = new Date()): string {
  const asked = params.get("range") as Range | null;
  const range: Range = asked && MINUTES[asked] ? asked : "1h";
  const { from, to } = resolveRange(range, now);

  // Tokens named in `off` keep their value in the URL and stay out of the query.
  const off = new Set((params.get("off") ?? "").split(",").filter(Boolean));

  const out = new URLSearchParams({ from, to });
  for (const key of FILTERS) {
    const value = params.get(key);
    if (value && !off.has(key)) out.set(key, value);
  }
  const cursor = params.get("cursor");
  if (cursor) out.set("cursor", cursor);

  return out.toString();
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter web vitest run src/lib/log-query.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Build the query bar**

Filters are chips, not fields: `service:pfa-api`, `level>=warn`, and a free-text token. Each shows `×` when active and `+` when off, dimming rather than disappearing, and toggling one edits `off` in the URL through `nuqs`.

To the right: the `● LIVE` / `❙❙ PAUSED` toggle (Task 27) and `⌘L fullscreen`.

- [ ] **Step 6: Build the table**

Columns `TIME · LVL · SERVICE · ROUTE · ST · MESSAGE · TRACE · DUR` — a direct projection of `log_entry`, which is why it costs nothing to serve.

`data-surface="terminal"` on the panel. Level colours from the tokens; error rows take `--ikn-error-bg` and a left edge; the selected row takes the accent edge; `traceId` is dotted-underlined.

Expanding a row shows the raw ECS JSON on the left, the stack (for errors) or process context (otherwise) on the right, and three actions: `⌥⏎ trace`, `⌘I issue`, `⌘C copy NDJSON`. `⌘I` is inert until `IKN-14` exists and is therefore **not rendered yet** — the same rule as the view list.

`LogPage` and `LogRow` come from `the shared response types`, never redeclared by hand.

- [ ] **Step 7: Wire up pagination**

Load-more, never numbered pages: `nextCursor` from the previous response goes into the next request and rows append rather than replace. Because the cursor is keyset rather than an offset, rows arriving during paging cannot shift the window and cause a duplicate or a skip.

- [ ] **Step 8: Verify**

With ingestion running: every filter combines and survives a reload; a switched-off token keeps its value; a `traceId` click reconstructs the request; load-more reaches the end with no repeated row; 10 000 loaded rows still scroll smoothly.

- [ ] **Step 9: Commit**

```bash
git add front
git commit -m "feat(web): logs panel with filter tokens and cursor pagination"
```

---
## Task 26: Volume histogram

**Files:**
- Create: `front/src/components/logs/histogram.tsx`, `front/src/lib/anomaly.ts`, `front/src/lib/anomaly.test.ts`

**Interfaces:**
- Consumes: `GET /api/logs/histogram` (Task 18) and `buildLogQuery` (Task 25).
- Produces: the stacked bar chart above the log table, and `anomalyIndex(buckets)`.

This is what turns the panel from a list you can read into a tool you can diagnose with: you see **when** it started before you read **what** happened.

- [ ] **Step 1: Write the failing anomaly test**

`front/src/lib/anomaly.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { anomalyIndex } from "./anomaly";

const flat = (n: number) => Array.from({ length: 20 }, () => ({ error: n, warn: 0, info: 10 }));

describe("anomalyIndex", () => {
  it("finds the spike", () => {
    const buckets = flat(1);
    buckets[13].error = 40;
    expect(anomalyIndex(buckets)).toBe(13);
  });

  it("stays silent on a flat series", () => {
    expect(anomalyIndex(flat(2))).toBeNull();
  });

  it("stays silent on a series of zeroes", () => {
    expect(anomalyIndex(flat(0))).toBeNull();
  });

  it("does not call two errors an anomaly", () => {
    // Two errors above a median of zero is not an incident, it is Tuesday.
    const buckets = flat(0);
    buckets[4].error = 2;
    expect(anomalyIndex(buckets)).toBeNull();
  });

  it("handles an empty series without throwing", () => {
    expect(anomalyIndex([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web vitest run src/lib/anomaly.test.ts`
Expected: FAIL — cannot resolve `./anomaly`.

- [ ] **Step 3: Implement it**

`front/src/lib/anomaly.ts`:

```ts
import type { Bucket } from "the shared response types";

const FLOOR = 3;

/**
 * The bucket whose error count sits furthest above the median, when that excess
 * clears both a small absolute floor and the median itself.
 *
 * Deliberately crude and explainable. Nobody should have to reverse-engineer
 * why a marker appeared on their chart, and a marker that fires on noise gets
 * ignored within a week — at which point it is worse than no marker.
 */
export function anomalyIndex(buckets: Pick<Bucket, "error">[]): number | null {
  if (buckets.length === 0) return null;

  const errors = buckets.map((b) => b.error);
  const sorted = [...errors].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;

  let best = -1;
  let bestExcess = 0;
  errors.forEach((n, i) => {
    const excess = n - median;
    if (excess > bestExcess) {
      bestExcess = excess;
      best = i;
    }
  });

  return bestExcess >= Math.max(FLOOR, median) ? best : null;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter web vitest run src/lib/anomaly.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Build the chart**

A client component fetching `/api/logs/histogram?${buildLogQuery(params)}` — the same builder as the table, so the two can never describe different windows.

Each bucket is a column of three stacked segments, error on top, then warn, then info, using `--ikn-error`, `--ikn-warn` and a dimmed accent. Buckets are already server-side counts; the component does no aggregation.

Under the bars, four time labels and, when `anomalyIndex` returns a bucket, the marker: `▲ 02:14:37 · +18 err`.

Clicking a bucket narrows `from`/`to` to that bucket by writing an explicit custom range into the URL. Table, histogram and live tail all re-read from the URL, so one click updates all three with no cross-component wiring.

- [ ] **Step 6: Verify**

Generate a burst of errors in a monitored app. The spike appears in the right bucket, the marker lands on it, clicking it narrows the range and the table below shows exactly those lines. Switch to `7d`: the bar count stays at or below sixty and the bucket size on the axis grows.

- [ ] **Step 7: Commit**

```bash
git add front
git commit -m "feat(web): log volume histogram with anomaly marker"
```

---

## Task 27: Live tail

**Files:**
- Create: `front/src/hooks/use-log-stream.ts`, `front/src/components/logs/live-toggle.tsx`

**Interfaces:**
- Consumes: `GET /api/logs/stream` (Task 19), `buildLogQuery` (Task 25).
- Produces: `useLogStream(query: string, enabled: boolean)` returning `{ rows, gaps, connected, paused }`.

- [ ] **Step 1: Write the hook**

`front/src/hooks/use-log-stream.ts`:

```ts
"use client";

import { useEffect, useRef, useState } from "react";
import type { LogRow } from "the shared response types";

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

- [ ] **Step 2: Build the toggle and the pause rule**

`live-toggle.tsx` builds its query with the same `buildLogQuery` the table and the histogram use, so the three views cannot diverge.

Pause on scroll: when the user leaves the top of the list, set `paused.current = true` and show a `N nouvelles lignes` button that resumes and jumps back. A list that jumps while you are reading it is unusable, and this one rule is the whole difference between a live tail people leave on and one they switch off.

Render a visible marker whenever `gaps` increases, and a connection indicator driven by `connected`.

- [ ] **Step 3: Verify the hard cases**

- A line appended to a PM2 log file appears within 2 seconds.
- Scrolling down pauses; the resume button restores the flow and the count is right.
- Restarting the Nest process shows a disconnect, then reconnects on its own with a gap marker.
- Changing a filter token while live rebuilds the stream against the new query.
- Leave the tab open 8 hours under real traffic; browser memory stays flat. If it climbs, `MAX_BUFFERED_ROWS` is not being applied.

- [ ] **Step 4: Commit**

```bash
git add front
git commit -m "feat(web): live tail with pause-on-scroll and gap markers"
```

---

## Task 28: Trace timeline modal

**Files:**
- Create: `front/src/components/logs/trace-modal.tsx`

**Interfaces:**
- Consumes: `GET /api/logs/trace/:traceId` (Task 18) and the modal shell (Task 22).
- Produces: the view opened by `⌥⏎` and by clicking a `traceId`.

- [ ] **Step 1: Build it**

The modal shell with tag `TRACE`, the trace id and the total duration in the title, and one row per log line: timestamp, service, route or operation, message, and a bar whose width is proportional to `duration_ms` against `totalMs`. The row that errored takes the error background and edge.

Actions: copy the trace id, and open the logs filtered to it.

- [ ] **Step 2: Say what it is, in the interface**

The hint line reads *"correlated through trace.id · N events"* — not "spans". This is a request timeline reconstructed from log rows, and distributed tracing remains out of scope (backend spec §11). Calling it a span tree in the UI would be a promise the data cannot keep, and someone would eventually rely on it.

A row with no `duration_ms` gets no bar rather than a zero-width one — absent and instant are different facts.

- [ ] **Step 3: Verify**

- `⌥⏎` on a selected row and a click on its `traceId` open the same view.
- The rows are in timestamp order and the bars sum visually to the total.
- A trace id that has exactly one row renders a single line without a degenerate chart.
- `esc` closes it and returns the selection to where it was.

- [ ] **Step 4: Commit**

```bash
git add front
git commit -m "feat(web): request timeline for a trace id"
```

---

## Task 29: Command palette, keyboard navigation and the status bar

**Files:**
- Create: `nest-api/src/search/search.controller.ts`, `front/src/hooks/use-shortcuts.ts`, `front/src/hooks/use-shortcuts.test.ts`, `front/src/components/chrome/palette.tsx`
- Modify: `front/src/components/chrome/status-bar.tsx`

**Interfaces:**
- Produces: `GET /api/search?q=&from=&to=`, the global key map, and the ⌘K palette. Every later view inherits all three.

The status bar advertises these permanently. That is what separates a dashboard you look at from a tool you use, and it is much cheaper to establish now than to retrofit across five views.

- [ ] **Step 1: Write the failing shortcut tests**

`front/src/hooks/use-shortcuts.test.ts`, in jsdom:

```ts
import { fireEvent, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useShortcuts } from "./use-shortcuts";

describe("useShortcuts", () => {
  it("fires a bare key", () => {
    const onNext = vi.fn();
    renderHook(() => useShortcuts({ j: onNext }));
    fireEvent.keyDown(window, { key: "j" });
    expect(onNext).toHaveBeenCalled();
  });

  it("stays out of the way while typing", () => {
    const onNext = vi.fn();
    renderHook(() => useShortcuts({ j: onNext }));

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "j" });

    // Otherwise searching for "json" moves the cursor four times.
    expect(onNext).not.toHaveBeenCalled();
  });

  it("still allows escape while typing", () => {
    const onEscape = vi.fn();
    renderHook(() => useShortcuts({ Escape: onEscape }));

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onEscape).toHaveBeenCalled();
  });

  it("prevents the browser default on the combinations it claims", () => {
    renderHook(() => useShortcuts({ "mod+l": vi.fn() }));
    const event = new KeyboardEvent("keydown", { key: "l", metaKey: true, cancelable: true });
    window.dispatchEvent(event);

    // Without this, ⌘L opens the address bar and the shortcut printed in the
    // status bar simply does not work.
    expect(event.defaultPrevented).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter web vitest run src/hooks/use-shortcuts.test.ts`
Expected: FAIL — cannot resolve `./use-shortcuts`.

- [ ] **Step 3: Implement the hook**

`use-shortcuts.ts` — one listener on `window`, mounted **once** in the chassis and never per page. Two pages each registering their own listener eventually fight over the same key, and which one wins depends on mount order.

```ts
const TYPING = new Set(["INPUT", "TEXTAREA"]);

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (TYPING.has(el.tagName) || el.isContentEditable);
}
```

Key names are normalised to `mod+k` form so the same map works on both platforms. `Escape` is the single key allowed through while typing.

The full map, all of it in the status bar's legend: `j` `k` `↑` `↓` move, `⏎` expands, `⌥⏎` opens the trace, `/` focuses the query bar, `⌘K` the palette, `⌘L` fullscreen logs, `⌘I` the issue, `⌘C` copies NDJSON, `⌘⇧L` logs out, `esc` closes.

The selection is clamped whenever the filters change: a filter that empties the list must not leave the cursor pointing past the end.

- [ ] **Step 4: Write the search route**

`nest-api/src/search/search.controller.ts` — one route, several sources, five results each:

```ts
const PER_TYPE = 5;

@Get("api/search")
async search(@Query("q") q: string, @Query("from") from: string, @Query("to") to: string) {
  const term = (q ?? "").trim();
  if (term.length < 2) return { results: [] };

  const [services, routes, traces] = await Promise.all([
    this.services.matching(term, PER_TYPE),
    // Bounded by the same window as everything else: `(route, ts)` is indexed,
    // but an unbounded DISTINCT over a partitioned table reads every partition.
    this.logs.distinctRoutes(term, new Date(from), new Date(to), PER_TYPE),
    this.logs.matchingTraceIds(term, new Date(from), new Date(to), PER_TYPE),
  ]);

  return { results: [...services, ...routes, ...traces, ...matchViews(term)] };
}
```

Issues join this list with `IKN-14`. Each result carries a `kind` (`SERVICE`, `ROUTE`, `TRACE`, `VIEW`), a label, and the action it performs — a palette result is an action, not a link.

- [ ] **Step 5: Build the palette**

One input, results grouped by kind with the action named on the right. `↑↓` navigates, `⏎` runs, `esc` closes.

Debounce the input and abort the previous request with an `AbortController`. Without the abort, fast typing lets the slowest response win and the list shows the results of a query the user has already replaced.

- [ ] **Step 6: Fill in the status bar**

Mode (`NORMAL` / `MODAL`), selected service, tail state, event count for the range, **`q {meta.tookMs}ms`**, the active-alert count (inert until `IKN-15`, so not rendered yet), and the keyboard legend.

The query time is the point: it is the only place a query that has quietly become slow becomes visible without anyone going to look for it.

- [ ] **Step 7: Run the tests and check the whole path**

Run: `pnpm --filter web vitest run src/hooks && pnpm test src/search`
Expected: PASS, 4 shortcut tests plus the search tests.

Then, without touching the mouse: log in, switch service from the palette, filter, move the selection with `j`/`k`, expand a row, open its trace, close it, and log out with `⌘⇧L`.

```bash
curl -si 'localhost:4310/api/search?q=api' | head -1
```

Expected: `HTTP/1.1 401 Unauthorized`.

- [ ] **Step 8: Commit**

```bash
git add front nest-api/src/search
git commit -m "feat: command palette, keyboard navigation and status bar"
```

---

## Task 30: Collector chrome — lag pill, ingest card, storage panel

**Files:**
- Create: `front/src/components/chrome/collector-pill.tsx`, `ingest-card.tsx`, `front/src/components/panels/storage-panel.tsx`

**Interfaces:**
- Consumes: `GET /api/collector/status` and `GET /api/collector/storage` (Task 21).
- Produces: the three places Iknos reports on itself.

- [ ] **Step 1: Build the pill**

Top bar, right of the range control: a pulsing dot and the lag. Green normally, amber past a lag threshold, red when the tailer has read nothing for several minutes.

`lagMs === null` renders `collector —`, never `collector 0.0s`. Zero means "perfectly up to date"; null means "I have not written anything yet". A cold start that renders as zero is a dead collector that looks healthy, which is the one failure this pill exists to prevent.

Polls every 10 seconds. The route reads memory only, so this is cheap by construction.

- [ ] **Step 2: Build the ingest card**

Bottom of the rail: `INGEST · 60m`, the sparkline from `perMinute` (Task 22's primitive), then the event count and the volume for the window.

Fewer than sixty samples after a restart draws a shorter line rather than padding the left with zeroes — zeroes there would read as "no traffic an hour ago", which is a different and false statement.

- [ ] **Step 3: Build the storage panel**

One row per table: a fill bar, the size, and the retention window. A footer carrying disk occupancy and the schedule — `mysql 5.1/20 GB · nightly purge 03:00`.

Every number is real: sizes from `information_schema`, retention and the oldest partition from `MaintenanceService.window()`. The mockup's `4.2 GB` against `14d` was decorative and must not be reproduced.

The panel lives in the alerts view, which does not exist until `IKN-15`. Until then, mount it under the ingest card in the rail — the numbers are useful now and moving one component later is cheap.

- [ ] **Step 4: Verify**

- `pm2 stop iknos-api`, wait, restart: the pill goes red and recovers on its own.
- Immediately after a restart the pill reads `—` and the sparkline is short, not zeroed.
- The sizes match `SELECT table_name, data_length+index_length FROM information_schema.TABLES` run by hand.
- The oldest partition matches `IKNOS_RETENTION_DAYS`.

- [ ] **Step 5: Commit**

```bash
git add front
git commit -m "feat(web): collector lag, ingest rate and storage panel"
```

---

## Task 31: Deployment

**Files:**
- Create: `nest-api/ecosystem.config.example.js`, `nest-api/deploy-api.sh`, `front/deploy-front.sh`
- Modify: `deploy/nginx/iknos.conf`, `README.md`, `DEPLOY.md`
- Delete: `mock/`, `deploy/deploy-mock.sh`

**Interfaces:**
- Consumes: the subdomain, certificate and vhost already installed on ks-b (2026-08-15).
- Produces: a deployed Iknos on its subdomain, and a one-command deploy.

Both processes are Node, so this is a copy-and-adapt of PFA's deployment — two independent halves, each with its own ecosystem file and its own deploy script, exactly as Zeus, PFA and spira are laid out. Build on ks-b, same release-directory scheme, no second machine.

**Half of this task is already done.** `iknos.1991computer.com` resolves, has its own certificate and a vhost in `/etc/nginx/conf.d/iknos.conf`, and serves a static mock. What is missing is the two PM2 processes and the deploy script — so this task *edits* the vhost rather than writing one, and the ports below are the ones already reserved, not placeholders:

| | port | pm2 name |
|---|---|---|
| api | `6900` (block `6900–6999`) | `iknos-api` |
| front | `3006` | `iknos-web` |

See `DEPLOY.md`. Both were verified free on ks-b with `ss -ltn` before being taken, and both are
**registered in Zeus since 2026-08-15**. That makes the registry the contract rather than a note:
every value in it — the two ports, the two pm2 names, `/health` outside `/api`, one ecosystem file
for both processes — is something this task has to match, or the Zeus dashboard reports drift. The
two rows read *not running* in red until Step 5, which is correct and not something to fix.

- [ ] **Step 1: Write the PM2 ecosystem file — one, and it declares the API only**

Read off ks-b rather than inferred. Every sibling has exactly this on the server:

```
/var/www/<app>/
  nest-api/              live API — the api process's cwd
  nest-api-releases/     timestamped releases
  nest-api.bak/          the previous release, kept for rollback
  public_html/           live front — the front process's cwd
  public_html.bak/
  deploy-logs/
  ecosystem.config.js    chmod 600, holds the secrets, declares the API
```

`/var/www/zeus/ecosystem.config.js` declares `zeus-nest-api` and nothing else. The front is not
in an ecosystem file: `zeus-front` runs `node_modules/next/dist/bin/next start -p 3003 -H
127.0.0.1` with `cwd=/var/www/zeus/public_html`. spira and trekker are identical bar the port.

So Iknos gets **one** `ecosystem.config.js`, deployed to `/var/www/iknos/`, declaring
`iknos-api`. `nest-api/ecosystem.config.example.js` is what lives in the repo; the real file is
gitignored because it holds the secrets.

```js
module.exports = {
  apps: [
    {
      name: "iknos-api",
      cwd: "/var/www/iknos/nest-api",
      // dist/src, not dist: the Prisma client generates to ../generated, so tsc's root covers
      // the whole package and the layout is mirrored one level down.
      script: "dist/src/main.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      // The Nest side drains on SIGTERM; give it room before SIGKILL.
      kill_timeout: 10000,
      max_restarts: 10,
      env_production: {
        NODE_ENV: "production",
        // Loopback only — nginx is the single public entrance. Node with no bind host listens
        // on every interface.
        HOST: "127.0.0.1",
        // From Zeus's registry: block 6900–6999, and an API sits on its block's first port.
        IKNOS_PORT: 6900,
        DATABASE_URL: "mysql://iknos:REPLACE_ME@127.0.0.1:3306/iknos",
        REDIS_URL: "redis://127.0.0.1:6379",
        IKNOS_LOG_LEVEL: "info",
        IKNOS_COOKIE_SECRET: "REPLACE_ME",
        IKNOS_RETENTION_DAYS: 14,
        IKNOS_PM2_LOG_GLOB: "/home/debian/.pm2/logs/*.log",
        // SHADOW_DATABASE_URL does NOT belong here — it exists only for `migrate dev`.
      },
    },
  ],
};
```

`iknos-web` is started the way its siblings are, from `public_html` after the front is built
there:

```bash
ssh ks-b 'cd /var/www/iknos/public_html && pm2 start node_modules/next/dist/bin/next \
  --name iknos-web -- start -p 3006 -H 127.0.0.1'
```

`IKNOS_PORT` is `6900` here and `4310` in local development. Dev runs on the laptop and
production on ks-b; pinning them together buys nothing.

The two PM2 names are what the service rail displays, because the rail shows what PM2 reports.
The mockup labels them `iknos-collector` and `iknos-ui`; the PM2 names win, and `Service.name`
exists if a friendlier label is ever wanted. They are also the names in Zeus's registry —
renaming either without updating the row is how a service silently stops being tracked.

- [ ] **Step 1b: Write the deploy script**

`nest-api/deploy-api.sh`, modelled on Zeus's and PFA's, and the directory names above are what
it creates:

1. rsync the package into `nest-api-releases/<timestamp>/`
2. `pnpm install --frozen-lockfile` and `pnpm build` **on the server**
3. move the live `nest-api/` aside to `nest-api.bak/`, move the new release into place
4. `pm2 reload iknos-api`
5. **on any failure after step 3, swap `nest-api.bak/` back and reload again** — that is the
   whole point of keeping it, and it is why the backup is a sibling directory rather than a
   tarball somewhere

Append a line per run to `deploy-logs/`.

**The script never migrates.** `prisma migrate deploy` is run by hand over SSH, same rule as PFA
and trekker.

The front's deploy follows the same pattern into `public_html` / `public_html.bak`.

- [ ] **Step 2: Take the vhost out of mock phase**

**Do not write a new vhost.** One already exists at `deploy/nginx/iknos.conf`, is installed at `/etc/nginx/conf.d/iknos.conf`, and is serving traffic. Writing a second one produces two files claiming `server_name iknos.1991computer.com`, and nginx resolves that by silently ignoring one of them.

It was written in trekker's shape — which is pfa's — with everything the API needs already present but commented out, including the SSE block. Two edits:

1. Delete the block bracketed by the `MOCK PHASE` banners: the `location /` that serves `/var/www/iknos/public_html`.
2. Uncomment the four proxy blocks below it — `^~ /api/logs/stream`, `/api/`, `= /health`, `/_next/static/`, and the final `location /`.

The ports in those blocks are already `6900` and `3006`. Nothing else in the file changes.

Then, from the laptop:

```bash
scp deploy/nginx/iknos.conf ks-b:/tmp/iknos.conf
ssh ks-b 'sudo cp /tmp/iknos.conf /etc/nginx/conf.d/iknos.conf && sudo nginx -t'
ssh ks-b 'sudo systemctl reload nginx'
```

Run `nginx -t` and read it before reloading — one nginx serves nine sites on ks-b. Its two pre-existing `conflicting server name ""` warnings come from `minimal-certbot.conf` and are not about this change.

Two things in that file worth knowing rather than rediscovering:

- **`^~ /api/logs/stream` must stay above `/api/`.** nginx picks the longest matching prefix; without `^~` the stream falls into the general block, gets buffered, and "live" arrives in clumps every few seconds. This is the line everyone forgets, which is why it was written before the route existed.
- **`X-Forwarded-For` on `/api/`.** The login and recovery rate limiters key on it. Without it every request appears to come from `127.0.0.1` and the first five failures lock out everybody.

One subdomain, so the browser stays on one origin and the session cookie and CSRF header work with no CORS configuration.

- [ ] **Step 2b: Retire the mock**

```bash
git rm -r mock deploy/deploy-mock.sh
```

**Do not delete `/var/www/iknos/public_html`.** It is where the front deploys — `iknos-web` runs
with that directory as its cwd, exactly as `zeus-front` and `spira-front` do. The front's build
replaces `index.html` in it; the directory itself stays.

Drop the mock's two rows from `README.md`'s documentation table and the mock section of `DEPLOY.md`. A static mock still being served from a path no vhost references is the kind of thing that is found two years later by someone wondering whether it matters.

- [ ] **Step 3: Write the deploy script**

Covered by Step 1b — `nest-api/deploy-api.sh` and `front/deploy-front.sh`, one per half. Each writes its own release marker:

It also writes the release marker, which is three lines and the difference between an issue that says `v2.19.0` and one that says `—`:

```bash
GIT_SHA=$(git rev-parse --short HEAD)
VERSION=$(node -p "require('./package.json').version")
printf 'IKNOS_RELEASE=%s\nIKNOS_COMMIT=%s\n' "$VERSION" "$GIT_SHA" > "$RELEASE_DIR/.release"
```

**The script never migrates.** Migrations are manual:

```bash
ssh ks-b 'cd /var/www/iknos/nest-api && pnpm prisma migrate deploy'
```

- [ ] **Step 4: Write the environment file**

`/var/www/iknos/shared/.env` holds `DATABASE_URL`, `REDIS_URL`, `IKNOS_COOKIE_SECRET`, `IKNOS_PORT`, `IKNOS_LOG_LEVEL`, `IKNOS_RETENTION_DAYS`, `IKNOS_PM2_LOG_GLOB`.

**`IKNOS_PORT=6900` here**, not the `4310` of `.env.example`. That file is the development default; this one is production, and `6900` is what the vhost proxies to and what Zeus's registry has reserved. Getting it wrong produces a vhost proxying to a closed port and a 502 on every route.

**Nothing here controls registration.** It seals itself once the account exists (Task 11), enforced by a unique constraint rather than a variable — so there is no line to forget, and none to flip back on while debugging at two in the morning.

- [ ] **Step 5: First deploy**

```bash
ssh ks-b 'mkdir -p /var/www/iknos/shared && chmod 700 /var/www/iknos/shared'
# Write /var/www/iknos/shared/.env with the real secrets, then:
ssh ks-b 'chmod 600 /var/www/iknos/shared/.env'
./nest-api/deploy-api.sh
./front/deploy-front.sh
ssh ks-b 'cd /var/www/iknos/nest-api && pnpm prisma migrate deploy && pnpm seed:user you@yourdomain'
ssh ks-b 'pm2 start /var/www/iknos/ecosystem.config.js --env production'
ssh ks-b 'cd /var/www/iknos/public_html && pm2 start node_modules/next/dist/bin/next --name iknos-web -- start -p 3006 -H 127.0.0.1'
ssh ks-b 'pm2 save && pm2 startup'
```

`seed:user` will prompt for the recovery passphrase. Answer it, and write the passphrase down somewhere that is not this machine — it is the only way back into the only account.

The browser path works equally well: skip `seed:user` and visit `/register` once, which is open until it isn't. Either way the instance seals itself afterwards, and the second attempt gets a 409.

- [ ] **Step 5b: Give Zeus the database name**

The migration above is the first moment Iknos has a schema on ks-b. Open Zeus's `/backups` page and
record it against the `iknos` app.

**Do not defer this.** Zeus dumps the databases it knows about; one it does not know about is not
dumped, and nothing anywhere reports the absence. Skipping this step leaves a running instance that
has been collecting logs for a week with no backup — strictly worse than having no instance, because
it looks fine.

- [ ] **Step 6: Verify against the milestone's criteria**

```bash
curl -si https://iknos.1991computer.com/api/me       | head -1   # expect 401
curl -si https://iknos.1991computer.com/health       | head -1   # expect 200
curl -s  https://iknos.1991computer.com/api/auth/bootstrap        # expect {"sealed":true}
curl -si -X POST https://iknos.1991computer.com/api/auth/register \
     -H 'content-type: application/json' -d '{}' | head -1   # expect 409
curl -si 'https://iknos.1991computer.com/api/logs'   | head -1   # expect 401
```

Then in a browser, working through the epic's acceptance list:

- log in, and confirm in devtools that the cookie carries `HttpOnly`, `Secure` and `SameSite=Lax` — only observable over real HTTPS;
- a line written by any PM2 app on ks-b appears in the logs view within 2 seconds;
- the histogram shows the window and clicking a bucket narrows it;
- a `traceId` opens the request timeline;
- the whole path works from the keyboard, without the mouse;
- the collector pill shows a real lag and the storage panel real sizes;
- the service rail lists four services, `iknos-api` among them — the tool watching itself;
- `/register` shows the sealed banner, and still does with the API stopped;
- recovery with the passphrase from Step 5 sets a new password, then log back in with it.

Then open Zeus. Both `iknos` rows go green, and the app reports no convention drift — that is the
external check on the two ports and the health URL, done by something that was not looking over your
shoulder while you wrote them.

Reboot the machine and confirm both processes return. Roll back to the previous release once, deliberately, so you know it works before you need it.

- [ ] **Step 7: Write the README**

Installation, environment variables, local commands, deploy and rollback, the manual migration step, the measured RSS of both processes after 24 hours, the measured steady-state database size, and the `GET /api/logs` response time measured against at least 10 M rows.

- [ ] **Step 8: Commit**

```bash
git add deploy/ README.md
git commit -m "feat(deploy): pm2, nginx and release-directory deployment"
```

---

## Self-Review

**Spec coverage — backend** (`2026-08-10-iknos-nestjs-api-design.md`): §3 architecture → Tasks 1, 7, 16; §4 data model → Tasks 2, 3, 20; §5 ingestion → Tasks 12–16; §6 API and auth → Tasks 4–11, 17, 18, 19; §7 the Next seam → Tasks 22, 23, 25; §8 deployment → Task 31; §9 testing → distributed through every task rather than gathered at the end.

**Spec coverage — UI** (`2026-08-09-iknos-ui-design.md`): §3 visual language → Task 22; §4 information architecture → Task 23; §5.1 log panel → Tasks 25, 26, 27, 28; §5.7 auth screens → Task 24; §6 interaction rules → Task 29; §7 what the front consumes → Tasks 18, 21, 29; §5.5 storage panel → Tasks 21, 30. Sections §5.2 through §5.6 describe views owned by later milestones (`IKN-13`, `IKN-23`, `IKN-14`, `IKN-15`) and are deliberately absent here.

**The three places Node needs discipline Rust gave for free** — all three are acceptance criteria, not commentary:
- Task 12, decoding only complete lines. Without it, a split codepoint becomes U+FFFD silently.
- Task 15, the queue ceiling checked by hand on every push. Node has no bounded channel.
- Tasks 16 and 19, unsubscribing on disconnect and never overlapping polls. Neither is enforced by anything but the code.

**Three constraints turned into tests rather than review comments**, because that is the only way they survive six months: the token ramps declaring identical variable sets and no bare hex in any component (Task 22), the view list refusing to advertise views that cannot answer (Task 23), and the histogram's bucket ceiling holding for any range a caller can ask for (Task 18).

**Borrowed rather than invented.** The auth shape in Tasks 10, 11 and 24 is Zeus's, read from `~/dev/Zeus/nest-api/src/auth/`: the `bootstrap` / `sealed` vocabulary, first-run registration sealed by a `UNIQUE` column instead of an environment flag, a recovery passphrase hashed independently of the password, one identical refusal across every recovery failure with the rate limit as the deliberate exception, and register and recover both opening no session. The front's `getBootstrap` is worldweathr's `getPublicConfig` — React `cache()`, schema-validated body, a defined answer when the API will not give one, and the decision taken on the server so no submittable form is ever briefly on screen. Neither was re-derived here, and neither should be re-derived when reading this.

**Deliberate deferrals**, noted rather than dropped: line and bar dataviz primitives are not built in Task 22 — M1 has no charts beyond the sparkline and the histogram's own bars, and they arrive with `IKN-13` and `IKN-23`; `front` is scaffolded as a placeholder in Task 1 before being built properly in Task 22; the `⌘I issue` action and the active-alert counter are wired but not rendered until `IKN-14` and `IKN-15` exist; the storage panel lives in the rail until the alerts view gives it its intended home.

**Values to fill in from your environment**, each called out at the step that needs it: the real `DUMMY_HASH` in Task 10 and `DUMMY_PASSPHRASE_HASH` in Task 11, and the known trace id and row count for the fixture window in Task 18. All are environment facts, not undecided design.

Task 31's domain and ports are no longer among them: `iknos.1991computer.com`, `6900` and `3006` are decided, live, and written into the vhost that is already installed.

**Ordering notes.**
- Task 10's first test asserts 401 on `/api/services` and `/api/logs`, which do not exist until Task 17. Nest returns 404 for an unmounted route, so either run that test after Task 17 or assert "not 200" until then.
- `app_user.singleton` is in Task 3's initial schema rather than Task 11's migration, even though registration is Task 11's subject. The CLI ships in Task 10; without the constraint already in place it could create the second account that makes the constraint impossible to add later.
- Task 21's storage response is only complete once Task 20 exposes `window()`. Both are before it in the order; if you reorder, keep that pair together.
