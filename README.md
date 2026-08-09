# Iknos

A self-hosted monitoring console for a small fleet of applications running on a single VPS.
Logs, metrics, issues and alerts for apps you already run, without operating an ELK stack to
get them.

**Status: design complete, no application code yet.** This repository currently holds the
specs, the mockup and the M1 implementation plan. Work is tracked in Spira under the `IKN`
project.

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
| Deployment | Two PM2 processes behind nginx, built on the target host |

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

Two documents are kept but **superseded**, because the reasoning in them is still worth
reading: [`specs/2026-08-09-iknos-rust-api-design.md`](docs/superpowers/specs/2026-08-09-iknos-rust-api-design.md)
and [`plans/2026-08-09-iknos-m1-logs.md`](docs/superpowers/plans/2026-08-09-iknos-m1-logs.md)
describe the same product with a Rust backend. The language changed for a reason unrelated to
architecture — carrying an unfamiliar language alongside several other active projects — and
most of the design survived intact.
