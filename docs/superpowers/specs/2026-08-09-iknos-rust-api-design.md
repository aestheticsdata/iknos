# Iknos — Rust collector + API

**Date:** 2026-08-09
**Status:** SUPERSEDED by `2026-08-10-iknos-nestjs-api-design.md`
**Kept because:** the storage reasoning in §4.2 (day partitioning over FULLTEXT) and the
ingestion semantics in §5 carried over unchanged to the NestJS design. This document records
why those choices were made, and why Rust was considered and then dropped — the reason was
mental load across concurrent projects, not anything the architecture turned up.

---

## 1. Why this document exists

The original Iknos design had no API tier. A Node daemon (`iknos-collector`) tailed PM2 log
files and wrote to MySQL; a Next app (`iknos-ui`) read that MySQL directly through Prisma in
its server components, with route handlers reserved for mutations and live tail.

This document replaces the backend half of that design with Rust, and in doing so
reintroduces the API tier the original deliberately avoided. The front end stays Next, the
database stays MySQL, and the project's founding principle is unchanged: **the tool is
disposable, the interfaces are not.** A monitored app still only writes ECS NDJSON to stdout
and exposes `GET /metrics` in Prometheus text format. It never talks to Iknos. Swapping
Iknos for Loki or Prometheus later is still a collector swap with zero change in the
monitored apps.

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Backend in Rust | The collector is byte-level work — partial-line buffering, inode rotation, never crashing on malformed input. Rust makes those cases explicit rather than emergent. Secondary: ~10–15 MB RSS versus ~100 MB for the Node equivalent, on a host already carrying PFA, Spira, Zeus and Worldweathr. |
| D2 | One binary, two roles | `iknos-server` runs ingestion tasks and the HTTP API in a single Tokio runtime. One PM2 process, one config, one connection pool, and live tail served from an in-process broadcast channel instead of polling MySQL. Crate boundaries keep a later split cheap. |
| D3 | `sqlx` over an ORM | Compile-time-verified SQL against a live schema, plain `.sql` migrations. Log search, batch inserts and partition management are all raw-SQL territory anyway — the original design already conceded search would go through `$queryRaw`. |
| D4 | Next stops touching MySQL | Server components fetch the Rust API over localhost. Sub-millisecond, and it leaves one owner of the schema. |
| D5 | Rust owns auth | Session, CSRF and rate limiting move into axum middleware. `IKN-6` requires that an unauthenticated `curl` be refused; with Rust holding the data, that has to be enforced by the data tier, not by network placement. |
| D6 | argon2id, not bcrypt | Accounts are CLI-created, so there are no existing hashes to stay compatible with. Same posture as the other apps, stronger primitive. |
| D7 | Partition `log_entry` by day; no FULLTEXT | See §4.2. This is the one decision that changes user-visible behaviour. |

## 3. Architecture

### 3.1 Repository layout

```
iknos/
  Cargo.toml              # workspace
  crates/
    iknos-core/           # domain types, config loading, error types
    iknos-store/          # sqlx: pool, queries, row structs
    iknos-ingest/         # tailer, parser, batch writer
    iknos-api/            # axum: router, auth, SSE
    iknos-server/         # the binary — wires ingest + api into one runtime
  migrations/             # plain .sql, applied by sqlx-cli
  web/                    # Next App Router, own pnpm workspace
  deploy/                 # ecosystem.config.js, nginx site
  docs/
```

`iknos-core` depends on nothing internal. `iknos-store` depends on `core`. `iknos-ingest` and
`iknos-api` each depend on `core` and `store`, and **not on each other** — they communicate
only through channels owned by `iknos-server`. That constraint is what makes D2's future
split a change to `main` rather than a refactor.

### 3.2 Runtime

`iknos-server` starts a Tokio runtime and supervises:

- **tailer** — one task per watched file, discovered from the `service` registry
- **writer** — drains a bounded mpsc, batches, commits
- **api** — the axum server
- **maintenance** — daily: roll the partition window, drop expired partitions

Two channels connect them:

- `mpsc::channel(N)` — tailer → writer. **Bounded.** When the writer falls behind, the tailer
  drops lines and increments a counter rather than growing a queue until the host dies. This
  is `IKN-7`'s "on préfère perdre du log que faire tomber MySQL", enforced by the channel type
  instead of by discipline.
- `broadcast::channel(M)` — writer → SSE subscribers. Lagging subscribers are dropped by the
  channel itself; a slow browser tab cannot back-pressure ingestion.

Every task is spawned with a supervisor that logs and restarts on panic with backoff. A
panicking tailer must not take the API down with it.

### 3.3 Self-observation

Iknos logs through `tracing` with a JSON subscriber emitting the same ECS shape it ingests,
so it monitors itself through its own pipeline. One guard, carried over from the original
design: write errors go to stderr prefixed with a marker the parser skips. Without it, a
database outage becomes an infinite loop — failed write, log the failure, ingest that log,
fail to write it.

## 4. Data model

Migrations are plain `.sql` under `migrations/`, applied with `sqlx migrate run`. As with
PFA, **the deploy script never migrates**; migrations are applied by hand over SSH.

### 4.1 Tables for the logs milestone

Only four tables ship in M1. The rest arrive with their feature, each as an additive
migration owned by the ticket that needs it — `IKN-8` creates the metrics and host tables,
`IKN-9` creates `issue` and `issue_event`, `IKN-10` creates `alert`. The original design
declared the whole schema up front because Prisma wanted one file; plain SQL migrations have
no such pull, and a table that arrives with its first writer is a table whose shape was
informed by writing it.

```sql
CREATE TABLE service (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(64)  NOT NULL,
  pm2_name    VARCHAR(64)  NOT NULL,
  metrics_url VARCHAR(255)     NULL,
  health_url  VARCHAR(255)     NULL,
  log_glob    VARCHAR(512)     NULL,
  enabled     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_service_name (name)
) ENGINE=InnoDB;

CREATE TABLE app_user (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email         VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at    DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_email (email)
) ENGINE=InnoDB;

CREATE TABLE ingest_offset (
  file_path   VARCHAR(512)    NOT NULL,
  dev         BIGINT UNSIGNED NOT NULL,
  inode       BIGINT UNSIGNED NOT NULL,
  byte_offset BIGINT UNSIGNED NOT NULL,
  updated_at  DATETIME(3)     NOT NULL,
  PRIMARY KEY (file_path)
) ENGINE=InnoDB;
```

`byte_offset`, not `offset` — `OFFSET` is reserved in MySQL 8.0. `app_user`, not `user`, for
the same family of reasons.

```sql
CREATE TABLE log_entry (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ts          DATETIME(3)     NOT NULL,
  service     VARCHAR(64)     NOT NULL,
  level       SMALLINT        NOT NULL,
  level_name  VARCHAR(16)     NOT NULL,
  logger      VARCHAR(128)        NULL,
  message     TEXT            NOT NULL,
  trace_id    CHAR(32)            NULL,
  http_method VARCHAR(10)         NULL,
  route       VARCHAR(255)        NULL,
  status_code SMALLINT            NULL,
  duration_ms INT                 NULL,
  client_ip   VARCHAR(45)         NULL,
  user_id     VARCHAR(64)         NULL,
  hostname    VARCHAR(128)        NULL,
  attrs       JSON                NULL,
  PRIMARY KEY (id, ts),
  KEY idx_service_ts (service, ts),
  KEY idx_level_ts   (level, ts),
  KEY idx_trace      (trace_id, ts),
  KEY idx_route_ts   (route, ts)
) ENGINE=InnoDB
PARTITION BY RANGE (TO_DAYS(ts)) (
  PARTITION p_future VALUES LESS THAN MAXVALUE
);
```

The primary key is `(id, ts)` because MySQL requires every unique key of a partitioned table
to contain the partitioning column. Keeping `id` leading satisfies InnoDB's separate rule
that an `AUTO_INCREMENT` column be the first column of some index.

`client_ip` is `VARCHAR(45)` rather than `VARBINARY(16)`. Binary storage would enable subnet
range queries, but `IKN-16` asks only to *display* IPs and run whois on demand. YAGNI.

### 4.2 Partitioning, and the loss of full-text search

Retention is `ALTER TABLE log_entry DROP PARTITION p20260726` — instant, no lock contention
on the rest of the table, and it returns disk to the operating system. That last property is
the one the original design could not offer: `IKN-11` correctly noted that InnoDB never
shrinks a `.ibd` after a `DELETE`, and then had no answer beyond a manual `OPTIMIZE TABLE`.

InnoDB does not allow FULLTEXT indexes on partitioned tables, so this costs us
`MATCH … AGAINST`. Three reasons that is an acceptable trade, in increasing order of weight:

1. Log queries are always time-scoped, so partition pruning does the selective work before
   any text predicate runs. Search runs against one day, not fourteen.
2. FULLTEXT index maintenance is expensive under a high insert rate, and deleted rows linger
   in the FT delete cache until an `OPTIMIZE TABLE` that locks the table.
3. **InnoDB's tokenizer is bad at logs.** Default minimum token length is 3, there is a
   stopword list, and it shreds paths, UUIDs and trace ids. You could not reliably search for
   `/api/users/42` or a trace id — which is most of what you actually want to search for.

Search is therefore: indexed filters (`service`, `level`, `route`, `status_code`) plus a
mandatory time range, with `message LIKE '%…%'` over the pruned set. Within one day of logs
on ks-b this is a scan of tens of megabytes at worst.

**The API enforces the time range.** A query without one is rejected, not silently widened —
otherwise the whole design collapses into a full table scan the first time someone forgets.

### 4.3 Partition maintenance

The migration creates only `p_future VALUES LESS THAN MAXVALUE`, so the table is correct and
writable from the first insert. The daily maintenance task then rolls the window:

```sql
ALTER TABLE log_entry REORGANIZE PARTITION p_future INTO (
  PARTITION p20260810 VALUES LESS THAN (TO_DAYS('2026-08-11')),
  PARTITION p_future  VALUES LESS THAN MAXVALUE
);
```

It maintains 3 days ahead and drops anything older than the retention window. If the task
stops, ingestion keeps working — rows simply accumulate in `p_future` — which is the right
failure mode: degraded, not broken. The task logs a line reporting partitions created,
partitions dropped, and rows freed.

**To verify before writing the migration:** the MySQL version on ks-b, and that native
InnoDB partitioning is available on it. MySQL 8.0 removed the generic partitioning handler
but keeps native InnoDB partitioning; this needs confirming against the actual server rather
than assumed.

## 5. Ingestion

### 5.1 Tailing

Sources are `~/.pm2/logs/*-out.log` and `*-error.log`, per-service globs configurable in the
`service` table. New files are detected while running.

Detection is `stat` on a one-second `tokio::time::interval`, not `inotify` — carried over
from the original design, and correct: filesystem watch APIs are unreliable across mount
types and give no benefit at this cadence.

Against the stored `(dev, inode, byte_offset)`:

- inode differs → the file was rotated. Finish reading the old handle if bytes remain, then
  restart the new one at 0.
- length < stored offset → truncated. Restart at 0.
- otherwise → resume exactly where we stopped.

### 5.2 Parsing

Reads land in a `BytesMut` and are split on `b'\n'`. **The trailing fragment stays in the
buffer as bytes and is only decoded once a complete line is available.** A read that lands
mid-codepoint therefore cannot corrupt anything — the failure mode the original design named
as "la source de corruption la plus classique de ce genre d'outil" is structurally excluded
rather than handled.

Per line, in order:

1. Valid JSON with ECS keys → typed columns (`@timestamp`, `log.level`, `message`,
   `trace.id`, `http.*`, `url.path`, `client.ip`…), everything else into `attrs`.
2. Valid JSON without ECS → `message` from `msg` if present, the whole object into `attrs`.
3. Not JSON → `message` is the raw line, level inferred from the stream (`-out` → info,
   `-error` → error) and refined by common prefixes (`ERROR`, `WARN`, `[Nest]`). ANSI escapes
   stripped.

A line that cannot be parsed is stored in degraded form. It never propagates an error.

### 5.3 Writing, and exactly-once resume

The writer flushes on 200 rows or 500 ms, whichever comes first, as a single multi-row
`INSERT` built with sqlx's `QueryBuilder`.

**The offset update is in the same transaction as the batch insert.** That single fact is
what delivers `IKN-7`'s "aucune ligne perdue, aucune ligne dupliquée" across restarts — not
careful ordering, just atomicity. Either both land or neither does, and on restart we resume
from a byte position that provably matches what is in the table.

## 6. API and auth

### 6.1 Origin

nginx serves one subdomain, routing `/api/*` to the Rust process and everything else to Next.
Same origin for the browser, so the session cookie and CSRF header behave exactly as
`IKN-6` specified. Mutations go browser → Rust directly, with no proxy hop. Next server
components separately forward the cookie on their own reads.

### 6.2 Session

Unchanged in properties from `IKN-6`, reimplemented in axum:

- Cookie `iknos.sid` — `httpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, signed.
- Value is an opaque 32 random bytes. The session lives in the existing Redis on ks-b under
  `iknos:sess:`, with a sliding 2h TTL.
- One active session per user; logging in clears the previous one.
- Passwords are argon2id (D6). Accounts are created by CLI subcommand
  (`iknos-server user create`). No public registration, no `POST /users`.
- 5 login attempts per minute per IP, counted in Redis, then 429.

### 6.3 CSRF

Token minted into the session, served by `GET /api/csrf`, returned by the client as
`x-csrf-token`, compared in constant time on **every** unsafe verb. Rotated on login, cleared
on logout.

### 6.4 Routes — M1

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/auth/login` | rate limited |
| `POST` | `/api/auth/logout` | CSRF |
| `GET` | `/api/csrf` | |
| `GET` | `/api/me` | |
| `GET` | `/api/services` | |
| `GET` | `/api/logs` | cursor-paginated; time range **required** |
| `GET` | `/api/logs/stream` | SSE off the broadcast channel |
| `GET` | `/health` | unauthenticated; liveness only, leaks nothing |

Everything except `/health` requires a valid session, enforced by a tower layer on the router
rather than per-handler. `/health` is the only public route and returns no detail.

Pagination is a keyset cursor on `(ts, id)`, not `LIMIT/OFFSET`. Deep offsets over a
partitioned table are exactly where naive pagination falls apart.

Later routes are owned by the page that needs them rather than gathered into one API ticket:
`IKN-13` writes the overview routes, `IKN-14` the issue routes and their mutations, `IKN-15`
the alert routes. Each ships its generated TypeScript declarations with it. This keeps a
route and its only consumer in the same change, which is worth more here than a tidy
API-shaped ticket boundary.

## 7. The Next seam

Server components `fetch` `http://127.0.0.1:<port>/api/…`, forwarding the incoming cookie.
Live tail is a client component on `EventSource` against `/api/logs/stream`.

To stop the two sides drifting, response structs derive `ts-rs` and emit TypeScript
declarations into `web/`. Generation runs in CI and the result is committed, so a mismatch is
a failed build rather than a runtime surprise.

The middleware split from `IKN-6` still applies, for the same reason: Next middleware runs on
the Edge runtime by default, so it checks only for the *presence* of the cookie and redirects
to `/login`. Real validation happens in Rust on every call.

## 8. Deployment

Two PM2 processes on ks-b: `iknos` (the Rust binary) and `iknos-web` (Next). PM2 runs
non-Node binaries natively; the ecosystem entry sets `interpreter: "none"`.

The binary is built on **vps-debian** (which otherwise only runs database backups) and moved
to ks-b. Neither the Mac nor ks-b compiles anything: macOS produces a Mach-O binary Linux
cannot execute at all, and ks-b's RAM is better spent running things than running rustc.

Build against `x86_64-unknown-linux-musl`, not glibc. A glibc-linked binary refuses to start
on any machine with an older glibc than the one that built it, which couples the two servers'
distro versions together forever. musl produces a fully static binary and removes the
coupling — available here because with `rustls` rather than OpenSSL nothing in the dependency
tree needs a C toolchain.

Deployment ships the artifact through the developer's laptop, which avoids granting SSH keys
between the two servers. Installation is `mv`, never `cp`: rename is atomic and succeeds even
though the old binary is executing, where `cp` fails with `ETXTBSY`. Keeping the previous
binary alongside makes rollback one command — there is no need for PFA's release-directory
scheme, which exists only because `node_modules` must match the code it was installed for.

The deploy script builds, ships, reloads PM2, and never migrates.

nginx terminates TLS, routes `/api/` and `/health` to the Rust port and `/` to the Next port,
and disables buffering on `/api/logs/stream` so SSE actually streams. That last line is the
one everyone forgets.

## 9. Testing

- **Parser** — unit tests over ECS, bare JSON, plain text, ANSI, lines split across reads,
  invalid UTF-8, truncated JSON. Table-driven.
- **Rotation** — against real temp files: inode swap mid-read, truncation, resume after
  restart. Not mocked; the bugs live in the syscall behaviour.
- **Ingestion round trip** — integration test against a scratch MySQL, ingest to query.
- **Restart integrity** — ingest, kill mid-batch, restart, assert exact line count and no
  duplicates. This is `IKN-7`'s primary acceptance criterion and it should be a test, not a
  manual check.
- **Memory** — 100k lines with RSS asserted flat, per the original criterion.
- **Auth** — session helper and CSRF comparison unit tests, plus a `curl`-level test that an
  unauthenticated request to every route returns 401.

## 10. Milestones

**M1 — walking skeleton (logs).** Tracked as epic `IKN-17`. Tailer → MySQL → auth → Logs
page, deployed behind nginx. In order: `IKN-3`, `IKN-18`, `IKN-6`, `IKN-7`, `IKN-19`,
`IKN-11`, `IKN-5`, `IKN-12`, `IKN-4`.

Retention (`IKN-11`) is in M1 rather than deferred: it is now a partition roll rather than a
batched delete, so it is small, and it is the difference between a tool that runs for a month
and one that fills a disk.

**M2 — metrics and health.** `IKN-2` (PFA side), `IKN-8`, `IKN-20`, `IKN-13`.
**M3 — issues and alerts.** `IKN-9`, `IKN-10`, `IKN-14`, `IKN-15`.
**M4 — security views.** `IKN-16`.

Two tickets are new, because the original backlog had no API tier to hang them on: `IKN-18`
(axum foundation) and `IKN-19` (logs endpoints and SSE). A third, `IKN-20`, was split out of
`IKN-11` — metric rollups depend on tables that do not exist until `IKN-8`, so keeping them
with log retention would have straddled two milestones.

## 11. Out of scope

Unchanged from the original design: notification channels, distributed traces, HTTP ingestion
from other hosts, per-user roles. The log schema and the table layout keep each of these
additive.

Newly out of scope: cross-compilation, containerisation, and any shared package between the
Rust and Next halves beyond the generated type declarations.

## 12. Open items

1. MySQL version and native partitioning support on ks-b — confirm before writing the first
   migration (§4.2).
2. Crate versions are pinned at implementation time with `cargo add`, not fixed here.
3. Whether the front stays in the same repo long-term. It does for now; the workspace layout
   does not depend on it.
