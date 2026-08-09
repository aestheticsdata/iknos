# Iknos — NestJS collector and API

**Date:** 2026-08-10
**Status:** approved
**Supersedes:** `2026-08-09-iknos-rust-api-design.md`

---

## 1. Why this document exists

Yesterday's design put the backend in Rust. It is now NestJS, for a reason that has nothing
to do with the architecture: Rust would have meant carrying an unfamiliar language alongside
several other active projects, and NestJS is a stack worth getting fluent in for its own sake.

Most of the previous document survives, because most of it was about storage and product
rather than about Rust. This document restates the whole design so it stands alone, and marks
the places where the language change forces a real difference — those are §5.2 and §8, and
they are the only two worth reading closely if you know the Rust version.

The founding principle is unchanged: **the tool is disposable, the interfaces are not.** A
monitored app writes ECS NDJSON to stdout and exposes `GET /metrics` in Prometheus text
format. It never talks to Iknos. Swapping Iknos for Loki or Prometheus later is a collector
swap with zero change in the monitored apps.

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Backend in NestJS | Same stack as PFA and the rest of the fleet. Auth, deployment and the design system become copy-and-adapt rather than reinvention, and the whole codebase stays reviewable. |
| D2 | One Nest app hosts the API **and** the collector | One PM2 process, one config, one Prisma client. Live tail is served from an in-process event stream rather than polling MySQL. Modules keep a later split cheap. See §3.2 for the caveat this carries in Node. |
| D3 | Prisma 7 with `@prisma/adapter-mariadb` | The pairing PFA already uses against MySQL. Raw SQL where it earns it — search, batch insert, partition DDL — through `$queryRaw` and `$executeRawUnsafe`. |
| D4 | Next stops touching MySQL | Server components fetch the Nest API over localhost, forwarding the session cookie. One owner of the schema. |
| D5 | Auth copied from PFA | Not merely the scheme — the actual `session` and `csrf-token.util.ts` code, adapted. This is the single largest saving from the language change. |
| D6 | `log_entry` partitioned by day, no FULLTEXT | Unchanged from the Rust design. See §4.2. |
| D7 | bcryptjs, as PFA uses | The Rust design chose argon2id because it was rewriting anyway. Sharing PFA's auth code means sharing its hashing. Consistency beats the marginal upgrade here. |

## 3. Architecture

### 3.1 Repository layout

```
iknos/
  pnpm-workspace.yaml
  prisma/schema.prisma          single schema
  packages/db/                  Prisma client + shared types
  apps/api/                     Nest: HTTP API + collector
    src/
      main.ts
      app.module.ts
      config/                   env schema and validation
      common/                   exception filter, logger, guards
      auth/                     session, csrf, guard, controller
      logs/                     controller, service, query builder
      stream/                   SSE controller, in-process event bus
      ingest/                   tailer, line buffer, parser, writer
      maintenance/              partition window and retention
  apps/web/                     Next App Router
  deploy/                       ecosystem, nginx, deploy script
```

`ingest` and `logs` both depend on `packages/db` and on the event bus, never on each other.

### 3.2 One process, one event loop

The API and the collector share a process, as in the Rust design and for the same reasons.
Node makes that choice carry a caveat Rust did not: there is one event loop, so a busy tailer
and an incoming request compete for it.

At this scale it is fine — the work is I/O-bound, and a few apps on one VPS will not saturate
a loop. But it sets a real limit, and the mitigation belongs in the design rather than being
discovered later: **the parser must never block**. No synchronous file reads, no unbounded
`JSON.parse` over megabyte lines (§5.2's line cap enforces that), no regex backtracking on
untrusted log text. If the loop ever does become the constraint, D2 splits into two PM2
processes and the event bus becomes Redis pub/sub — which is why `ingest` and `logs` do not
import each other.

Two channels connect the halves:

- A **bounded queue** between tailer and writer. When the writer falls behind, the tailer
  drops lines and increments a counter rather than growing an array until the process dies.
  Node gives you no bounded channel for free, so this is an explicit array with a length
  check — see §5.3. It is the single most important thing to not get lazy about.
- An **EventEmitter** from writer to SSE subscribers, with a per-subscriber cap so a slow
  browser tab cannot retain memory.

### 3.3 Self-observation

Iknos logs through pino with `@elastic/ecs-pino-format` — the same emitter `IKN-1` puts in
PFA, so it monitors itself through its own pipeline with no special casing.

One guard carries over: write failures go to stderr prefixed with a marker the parser skips.
Without it a database outage becomes an infinite loop — failed write, log the failure, ingest
that log, fail to write it.

## 4. Data model

Prisma owns the schema; `prisma migrate dev` locally, `migrate deploy` **manually over SSH**.
The deploy script never migrates, same rule as PFA.

### 4.1 Tables for the logs milestone

Four models ship in M1 — `Service`, `User`, `IngestOffset`, `LogEntry`. The rest arrive with
their feature, each as an additive migration owned by the ticket that needs it.

`LogEntry`: `ts` (DATETIME(3)), `service`, `level` (SMALLINT), `levelName`, `logger`,
`message` (TEXT), `traceId`, `httpMethod`, `route`, `statusCode`, `durationMs`, `clientIp`,
`userId`, `hostname`, `attrs` (JSON). Indexes on `(service, ts)`, `(level, ts)`,
`(traceId, ts)`, `(route, ts)`.

`IngestOffset`: `filePath` (unique), `dev`, `inode`, `byteOffset`, `updatedAt`.

### 4.2 Partitioning, and the loss of full-text search

Unchanged from the Rust design, and still the right call.

Retention is `ALTER TABLE LogEntry DROP PARTITION p20260726` — instant, no lock contention,
and it returns disk to the operating system. InnoDB never shrinks a `.ibd` after a `DELETE`,
so a batched-delete design can only ever grow.

InnoDB forbids FULLTEXT indexes on partitioned tables, so this costs `MATCH … AGAINST`. Three
reasons that is acceptable, in increasing order of weight:

1. Log queries are always time-scoped, so partition pruning does the selective work first.
2. FULLTEXT index maintenance is expensive under a high insert rate, and deleted rows linger
   in the FT delete cache until an `OPTIMIZE TABLE` that locks the table.
3. **InnoDB's tokenizer is bad at logs.** Minimum token length 3, a stopword list, and it
   shreds paths, UUIDs and trace ids — you could not reliably search `/api/users/42` or a
   trace id, which is most of what you actually want to search for.

Search is therefore indexed filters plus a mandatory time range, with `message LIKE '%…%'`
over the pruned set.

**Prisma cannot express partitioning.** The partition clause and the daily `REORGANIZE`/`DROP`
statements are raw SQL: the initial clause goes into the generated migration by hand, and the
maintenance job uses `$executeRawUnsafe`. `prisma migrate diff` must be checked after the
first migration to confirm Prisma does not consider the table drifted — if it does, the
partition clause needs to move into a migration Prisma treats as opaque.

### 4.3 Partition maintenance

The migration creates only `p_future VALUES LESS THAN MAXVALUE`, so the table is writable
from the first insert. A daily job maintains three days ahead and drops anything past the
retention window. If the job stops, ingestion keeps working — rows accumulate in `p_future`.
Degraded, not broken.

Partition names are built from dates, never from user input, which is what makes
`$executeRawUnsafe` acceptable here. That constraint is not optional.

## 5. Ingestion

### 5.1 Tailing

Sources are `~/.pm2/logs/*-out.log` and `*-error.log`, globs configurable per service.
Detection is `stat` on a one-second interval, **not `fs.watch`** — it is unreliable across
filesystems and gains nothing at this cadence.

Against the stored `(dev, inode, byteOffset)`: a changed inode means rotation (finish the old
handle, restart at 0), a length below the stored offset means truncation (restart at 0),
otherwise resume exactly.

### 5.2 Parsing — the part Node makes harder

Reads land in a `Buffer` and are split on `0x0A`. **The trailing fragment stays a Buffer and
is only decoded once a complete line exists.**

In Rust this was enforced by the type system: you could not accidentally treat bytes as a
string. In Node, `chunk.toString()` on a partial read silently produces U+FFFD replacement
characters and the corruption is invisible until someone searches for an accented word and
finds nothing. So what was structural becomes a convention, and conventions need tests:
splitting a multi-byte codepoint across two reads is a required test case, not a nice-to-have.

A single line is capped (1 MB); beyond that the buffer is discarded with a warning, so a file
with no newlines cannot grow the heap without bound.

Per line: ECS JSON → typed columns, both dotted (`"log.level"`) and nested (`{"log":{...}}`)
shapes accepted; bare JSON → `msg` as the message, whole object into `attrs`; plain text →
raw line, level from the stream and refined by prefixes, ANSI stripped. An unparseable line
is stored degraded and never throws.

### 5.3 Writing, and exactly-once resume

The writer flushes on 200 rows or 500 ms, whichever comes first, via `createMany`.

**The offset update is in the same transaction as the batch insert** — `prisma.$transaction`
around `createMany` plus the `IngestOffset` upsert. That atomicity, not careful sequencing, is
what delivers no-loss-no-duplicate across restarts.

The queue between tailer and writer is a plain array with an explicit length check on push.
There is no bounded channel in Node to lean on, and an unbounded queue under a log burst is
the most likely way this process dies.

## 6. API and auth

nginx routes `/api/*` to Nest and everything else to Next on one subdomain, keeping the
browser on one origin so the cookie and CSRF header behave.

Auth is PFA's, adapted: `iknos.sid` cookie (httpOnly, Secure, SameSite=Lax, signed), opaque
32-byte id, Redis-backed session under `iknos:sess:` with a sliding TTL, one active session
per user, CSRF token minted in-session and compared in constant time on every unsafe verb,
bcryptjs hashes, accounts created by CLI, 5 login attempts per minute per IP.

Two deliberate departures from PFA: a **2h** TTL rather than 10 minutes, because a dashboard
lives in a background tab; and a global `SessionGuard` registered with `APP_GUARD` with an
`@Public()` decorator for the exceptions, so a controller added later is protected by default
rather than by remembering.

Routes for M1: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/csrf`, `GET /api/me`,
`GET /api/services`, `GET /api/logs`, `GET /api/logs/stream`, `GET /health`.

`GET /api/logs` **rejects any request without both `from` and `to`** — a forgotten range must
be a loud 400, not a silent full scan. Pagination is a keyset cursor on `(ts, id)`, never
`LIMIT/OFFSET`: deep offsets over a partitioned table are exactly where naive pagination
falls apart.

## 7. The Next seam

Server components fetch `http://127.0.0.1:<port>/api/…` forwarding the incoming cookie. Live
tail is a client component on `EventSource`.

Response DTOs live in `packages/db` (or a small `packages/contracts`) and are imported by both
sides. This replaces the Rust design's generated declarations — with TypeScript on both ends
the contract is just a shared type, which is one of the concrete simplifications of this
decision.

Next middleware still only checks for cookie *presence* and redirects, because it runs on the
Edge runtime where no Redis client works. Real validation happens in Nest on every call.

## 8. Deployment — now identical to the other apps

Two PM2 processes: `iknos-api` (Nest) and `iknos-web` (Next). Both are Node, so the entire
cross-compilation problem the Rust design carried simply does not exist. Build on ks-b, same
release-directory scheme as PFA, same script shape, no second build machine, no static
linking, no atomic-rename dance.

nginx terminates TLS, routes `/api/` and `/health` to the Nest port and `/` to the Next port,
sets `X-Forwarded-For` so the login rate limiter keys on the real client, and disables
buffering on `/api/logs/stream` so SSE actually streams. That last line is the one everyone
forgets.

Migrations are applied by hand over SSH. The deploy script never migrates.

## 9. Testing

- **Parser** — ECS both shapes, bare JSON, plain text, ANSI, lines split across reads,
  **a read splitting a UTF-8 codepoint**, truncated JSON, the self-error marker.
- **Rotation** — real temp files: inode swap mid-read, truncation, resume after restart.
- **Durability** — a failed batch leaves neither rows nor an advanced offset.
- **Restart integrity** — ingest, kill mid-batch, restart, assert exact line count.
- **Backpressure** — a saturated queue drops and counts rather than growing.
- **Auth** — session and CSRF units, plus a `curl`-level test that every route returns 401
  without a session.

## 10. Milestones

**M1 — walking skeleton (logs).** Epic `IKN-17`. In order: `IKN-3`, `IKN-18`, `IKN-6`,
`IKN-7`, `IKN-19`, `IKN-11`, `IKN-5`, `IKN-12`, `IKN-4`.

**M2 — metrics and health.** `IKN-2`, `IKN-8`, `IKN-20`, `IKN-13`.
**M3 — issues and alerts.** `IKN-9`, `IKN-10`, `IKN-14`, `IKN-15`.
**M4 — security views.** `IKN-16`.

## 11. Out of scope

Notification channels, distributed traces, HTTP ingestion from other hosts, per-user roles.
The log schema and table layout keep each of these additive.

## 12. Open items

1. MySQL version and native InnoDB partitioning on ks-b — confirm before the first migration.
2. Whether `prisma migrate diff` reports drift on the partitioned table (§4.2).
