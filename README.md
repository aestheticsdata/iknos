# Iknos

A self-hosted monitoring console for a small fleet of applications running on a single VPS.
Logs, metrics, issues and alerts for apps you already run, without operating an ELK stack to
get them.

**Status: M1 in progress.** The API and the collector are deployed and running on the box:
single-account auth, the PM2 log collector, and the log read routes (search, histogram, trace,
live tail). The four authentication screens are the real Next app; `/` is still the static mock
of the console at **<https://iknos.1991computer.com>**, because the app chassis and its views
have not landed yet. Work is tracked in Spira under the `IKN` project.

---

## The founding principle

**The tool is disposable, the interfaces are not.**

A monitored application writes ECS NDJSON to stdout and exposes `GET /metrics` in Prometheus
text format. It never talks to Iknos, never imports an Iknos client, never knows Iknos exists.
Iknos reads what PM2 already writes to disk and what the app already exposes over HTTP.

The consequence is the point: replacing Iknos with Loki or Grafana later is a collector swap
with zero change in the monitored applications.

## How it works

```
app (pino + @elastic/ecs-pino-format)
  │  stdout ──▶ ~/.pm2/logs/*.log
  │  GET /metrics (Prometheus text)
  ▼
iknos-api (NestJS)          tailer → parser → batch writer → MySQL
  │                         in-process event bus → SSE live tail
  ▼
iknos-web (Next App Router) ── /api/* over localhost, session cookie forwarded
```

- **Ingestion** tails PM2 log files by `stat` polling, tracking `(dev, inode, byteOffset)` so
  rotation, truncation and restarts resume exactly. The batch insert and the offset update
  share one transaction, which is what delivers no-loss-no-duplicate rather than careful
  sequencing.
- **Storage** is MySQL 8 with `log_entry` in daily `RANGE` partitions. Retention is
  `DROP PARTITION` — instant, and it returns disk to the OS, which a batched `DELETE` never
  does. The cost is full-text search — InnoDB forbids `FULLTEXT` on a partitioned table — so
  search is indexed filters over a mandatory time range plus `LIKE` on the pruned set. That
  trade is fine here: InnoDB's tokenizer shreds paths, UUIDs and trace ids, which is most of
  what you actually want to search a log for. Default retention is 14 days.
- **The API** serves keyset-paginated log queries, a volume histogram, a trace view assembled
  from rows sharing a `trace.id`, and a live tail over SSE. Every list response carries
  `meta.tookMs`, which the status bar renders, so a query that has quietly become slow is
  visible without going looking.
- **Self-observation** — Iknos logs through the same pino emitter it asks of everything else,
  so it is monitored by its own pipeline with no special casing.

### Two ways in

Tailing covers everything with a stdout, which is every backend and every server-rendered page.
It cannot reach a browser: a page has no stdout, so a JavaScript error never touches the host's
disk. Sentry, OpenTelemetry and pino's HTTP transports all resolve that the same way, because
there is only one way out of a browser — a POST.

So there is exactly one write route, `POST /api/ingest`, and it accepts **the same ECS JSON the
app would have printed to stdout**, through the same parser, into the same table. One schema, one
definition of what a log line is, and a posted browser error is indistinguishable from a tailed
server line once it lands.

It stays on the collector for everything else, and not out of purism: a process that crashes does
not POST its own stack trace. Tailing catches the crash, the OOM kill, PM2's restart line and the
output of libraries nobody controls.

The route is `@Public()` — a page on another domain has no session and never will. Four cheap
checks stand in for one, and the token is deliberately the weakest: it ships inside a JavaScript
bundle, so it names a sender rather than authenticating one, exactly like a Sentry DSN key. The
service registry lookup, the origin allowlist and the rate limit are what actually hold. With no
token configured the route answers 503 and the rest of the API boots normally.

`front/src/instrumentation-client.ts` is the reference client, meant to be copied into the fleet's
other frontends rather than imported by them.

### The read routes

Every one of them sits behind the session guard, which is registered globally and denies by
default — a route is public only if someone wrote `@Public()` on it.

| Route | What it answers |
|---|---|
| `GET /api/logs` | Filtered search, keyset-paginated, newest first |
| `GET /api/logs/histogram` | Counts per interval and per level, server-chosen granularity |
| `GET /api/logs/trace/:traceId` | The lines sharing a `trace.id`, in order |
| `GET /api/logs/stream` | Live tail over SSE, straight off the in-process bus |
| `GET /api/services` | The registry, for the filters and the service rail |
| `POST /api/ingest` | The one write route — see below |

`from` and `to` are **required** on all of them and a request without both is a 400, never a
widened default. That single rule is what the partitioning rests on: the range predicate lets
MySQL discard whole partitions before it evaluates a filter, and one forgotten parameter would
otherwise turn a page load into a scan of the entire retention window.

### Measured

On **10,240,001 rows** across seven daily partitions (4.5 GB), on a laptop — median of five runs:

| Query | |
|---|---|
| Search, one day, one service | **2 ms** |
| Search, one day, one service, `LIKE` substring | 275 ms |
| Search, one day, page 20 by cursor | 240 ms |
| Search, seven days, `level >= 50`, every service | **4,719 ms** |
| Histogram, one day, 24 buckets, every service | 920 ms |
| Histogram, one day, one service | 494 ms |
| Trace lookup, seven days | **4 ms** |
| `DROP PARTITION` of all 10.2 M rows | 2,043 ms, 4.5 GB returned |

Two things to read out of that. The common case — a day, a service — is instant, and so is a
trace. The weak spot is a **wide window with no service filter**: seven days of every service at
`level >= 50` takes nearly five seconds, because a range predicate on `level` cannot also use
`ts` inside the same index. If the fleet ever grows to this volume, that query needs either a
mandatory service filter or its own composite index.

This is a ceiling, not an expectation. The fleet these numbers were built for logs a few thousand
lines a day, not the 1.4 million a day this table holds — roughly **150× more than reality**. At
the real volume every one of these is sub-millisecond and none of the partitioning matters. It is
measured here so the number exists before someone needs it, not because it is needed now.

## The interface

Service-scoped, not fleet-wide: you pick a service in the rail and the whole screen answers
about that service. A dark chassis that never moves, a light work surface you read for an
hour, and the log stream as a dark window inset into it. One screen at 1440×900, no page
scroll. Keyboard is a first-class input (`j/k`, `⌘K`, `⌘L`, `⌥⏎`), advertised permanently in
the status bar.

Views whose data does not exist yet are **absent, not faked** — no placeholder charts, no
lorem numbers.

See [`docs/design/iknos-prototype.dc.html`](docs/design/iknos-prototype.dc.html) for the
retained mockup.

## Stack

| Layer | Choice |
|---|---|
| API + collector | NestJS, one process, two modules that never import each other |
| ORM | Prisma 7 with `@prisma/adapter-mariadb`, raw SQL where it earns it |
| Database | MySQL 8, daily RANGE partitioning on `TO_DAYS(ts)` |
| Sessions | Redis, opaque cookie, CSRF compared in constant time |
| Web | Next App Router, Tailwind v4, `nuqs` for URL state |
| Deployment | Two PM2 processes behind nginx, built on the target host — `iknos-web` on 3006, `iknos-api` on 6900 |

The repository is laid out like the rest of the fleet: `nest-api/` and `front/` side by side,
each an independent pnpm root with its own lockfile, Prisma inside the API, and one deploy
script per half. Same shape as Zeus, PFA and spira, so a habit learned in one of them transfers
without translation. There is deliberately no root workspace and no shared package — the front
restates the response types rather than importing them, which is the call trekker made and
documents in the files that do it.

Auth is single-account and self-sealing: registration is open while the user table is empty
and closed forever after, enforced by a `UNIQUE` column rather than an environment flag
someone has to remember to set. There is no mail server on the host, so recovery is a
passphrase chosen at account creation.

## Milestones

| | Scope |
|---|---|
| **M1** | Walking skeleton — ingestion, log panel, histogram, live tail, trace view, auth, ⌘K palette, collector status |
| **M2** | Metrics and health — Prometheus scraping, health probes, hourly rollups, service and metrics views |
| **M3** | Issues and alerts — error grouping by fingerprint, an alert rule engine, and the views for both |
| **M4** | nginx access logs with visible client IPs and on-demand whois — the host is probed daily |

The emitter side of M1 and M2 lands in the monitored applications rather than here: ECS
logging and a `/metrics` endpoint are one ticket each per app.

Out of scope throughout: notification channels, distributed tracing, HTTP ingestion from other
hosts, per-user roles. The schema keeps each of those additive.

## Documentation

| Document | What it is |
|---|---|
| [`specs/2026-08-10-iknos-nestjs-api-design.md`](docs/superpowers/specs/2026-08-10-iknos-nestjs-api-design.md) | Backend design — storage, ingestion, API, auth, deployment |
| [`specs/2026-08-09-iknos-ui-design.md`](docs/superpowers/specs/2026-08-09-iknos-ui-design.md) | UI design and information architecture, from the mockup |
| [`plans/2026-08-10-iknos-m1-logs-nestjs.md`](docs/superpowers/plans/2026-08-10-iknos-m1-logs-nestjs.md) | M1 implementation plan, 31 tasks, TDD step by step |
| [`design/`](docs/design/) | The mockup, and the exploration that produced it |
| [`DEPLOY.md`](DEPLOY.md) | The box, the ports, the vhost, and how the mock gets shipped |
| [`mock/index.html`](mock/index.html) | The static mock behind the URL above — one file, no build |

Two documents are kept but **superseded**, because the reasoning in them is still worth
reading: [`specs/2026-08-09-iknos-rust-api-design.md`](docs/superpowers/specs/2026-08-09-iknos-rust-api-design.md)
and [`plans/2026-08-09-iknos-m1-logs.md`](docs/superpowers/plans/2026-08-09-iknos-m1-logs.md)
describe the same product with a Rust backend. The language changed for a reason unrelated to
architecture — carrying an unfamiliar language alongside several other active projects — and
most of the design survived intact.
