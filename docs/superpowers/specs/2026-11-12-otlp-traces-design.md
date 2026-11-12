# OTLP traces — per-application write tokens, the span table, and a Traces view

**Ticket:** IKN-87. **Branch:** `feat/otlp-traces`.
**Senders:** the Officina browser apps — Opifex, Vidar, Auscult, Groma, Auspex at
`https://<app>.1991computer.com` — exporting their AI pipeline runs as OpenTelemetry traces under
the GenAI semantic conventions.
**Precedent:** IKN-29 (`POST /api/ingest`, one global token, env origin list) and the M4 nginx
design (`2026-09-16-iknos-m4-nginx-ingestion-design.md`) for the shape of a new ingestion source.

The README's "ECS, and why not OpenTelemetry" declined OTel because nothing in the fleet produced
spans. The Officina apps do: a pipeline run is a tree of timed steps, which a log line cannot hold.
This adds the trace half of OTLP, and only that half.

---

## 1. Decisions

| | Decision | Why |
|---|---|---|
| D1 | OTLP/HTTP **JSON only**, traces only | The senders are browsers; the JSON encoding needs no protobuf runtime on either side. Protobuf answers 415, logs and metrics are not accepted — logs stay ECS on stdout, metrics Prometheus |
| D2 | The body is read **as text** for both `application/json` and `text/plain`, then `JSON.parse`d | The page's final flush is `navigator.sendBeacon`, which cannot set headers and must stay CORS-simple, so it is `text/plain`. One reader, one parse, one 1 MB ceiling. Registered before the global JSON parser via body-parser's `type` function, scoped to the one path |
| D3 | **One token per application**, a row in `ingest_token` | IKN-29's single env token cannot say *which* app sent a span. A row names one service, its origins, and can be revoked alone |
| D4 | Store **SHA-256** of the token, never the token | The token is 32 random bytes, so there is no dictionary to slow down — a KDF would only cost latency. A dump of the table holds nothing replayable |
| D5 | The token decides the service; `service.name` in the payload is dropped | A token for Opifex must not be able to write as Vidar, or as `iknos-api` |
| D6 | Token in `X-Iknos-Token`, or `?token=` for the beacon | The beacon cannot set a header. The query form is redacted wherever a URL is stored (D11) |
| D7 | CORS per route, from the tokens: preflight for **any** active token's origin, the POST against **its** token's list (403) | A preflight carries no custom header, so it cannot be answered per token. CORS is not the guard; the token check on the POST is |
| D8 | `Timing-Allow-Origin` mirrors `Access-Control-Allow-Origin` | The apps show the bytes they sent to their telemetry host via the Resource Timing API, which reports zero sizes cross-origin without TAO |
| D9 | Rate limit per address **before** the token lookup (240/min), then per token (120/min), Redis, env-configurable | The first bounds how many DB reads a token-guesser can cause; the second keeps one runaway app off another's budget |
| D10 | `span` day-partitioned on `ts`, in `MANAGED_TABLES` on the **log** window | The same retention as the logs the runs are read beside. `DROP PARTITION`, not `DELETE` |
| D11 | Redact `token` query params in nginx's parsed `attrs.query`, the API's pino `url.query`, and the unhandled-exception `url` | All three are tailed back into `log_entry`; without it a working credential would sit in the logs for the retention window |
| D12 | Unique `(trace_id, span_id, ts)` + `createMany({ skipDuplicates })` | Exporters retry, and a page may flush the same spans by `fetch` and then by beacon. A resend is stored once, not drawn twice |
| D13 | `ts` (ms, partition key) **and** `start_us` / `duration_us` (µs) | JS `Date` stops at the millisecond; a 300 µs step under a 4 s generation needs microseconds to draw |
| D14 | Envelope errors → 400; a bad span → counted in `partialSuccess.rejectedSpans` | The OTLP contract, and the collector's rule: one bad record costs itself |
| D15 | A new `SpanWaterfall`, not `TraceTimeline` | The log trace view is flat on purpose — log lines sharing an id say nothing about causality. Spans name their parent, so this one nests |

---

## 2. The contract

`POST /api/otlp/v1/traces` — `@Public()`, nginx's existing `location /api/` proxies it.

| | |
|---|---|
| Content-Type | `application/json` or `text/plain` (any charset parameter). Anything else: **415** |
| Token | header `X-Iknos-Token: ikt_…`, else query `?token=ikt_…`. Missing, unknown, revoked, or its service disabled/absent: **401** |
| Origin | absent → allowed (server-side senders). Present and not in the token's list: **403** |
| Rate | per address 240/min (`IKNOS_OTLP_IP_RATE_PER_MINUTE`), per token 120/min (`IKNOS_OTLP_TOKEN_RATE_PER_MINUTE`): **429** + `Retry-After: 60` |
| Body | > 1 MB: **413** (body reader). Not JSON, not an object, `resourceSpans`/`scopeSpans`/`spans` not arrays, > 1 000 spans: **400** |
| Success | **200** `{"partialSuccess":{}}`, or `{"partialSuccess":{"rejectedSpans":n,"errorMessage":"reason; reason"}}` |

Preflight `OPTIONS` on the same path: **204**, with `Access-Control-Allow-Origin` and
`Timing-Allow-Origin` set to the origin when any active token lists it, `Allow-Methods: POST`,
`Allow-Headers: Content-Type, X-Iknos-Token`, `Max-Age: 600`, `Vary: Origin`. The POST carries the
same allow headers, so a refused page can read its 403.

### What a span must be

- `traceId` 32 hex, `spanId` 16 hex, neither all zeros (lower-cased on the way in).
- `parentSpanId` absent, empty, all zeros (a root) or 16 hex.
- `name` a string (cut to 255).
- `startTimeUnixNano` / `endTimeUnixNano` digit strings (or integers), end ≥ start, start no older
  than the retention and no more than an hour ahead of the server.
- `kind` 0–5 else 0; `status.code` 1 or 2 else 0; `status.message` cut to 1 024.

Attributes: string, bool, int (string or number; past 2⁵³ kept as its digits), double, and flat
arrays of those (128 items). Strings cut at 32 768 characters, at most 128 attributes per span and
per resource, keys ≤ 255. `bytesValue`, `kvlistValue` and non-finite doubles are dropped. Unknown
fields — `links`, `flags`, anything newer — are ignored. `events` are read since v2 (§7).

Resource attributes are kept as `resource.<key>` (minus `service.name`), the scope as
`otel.scope.name` / `otel.scope.version`. The four GenAI fields move out of `attrs` into columns
when they fit them; one that does not (a negative count) stays in `attrs` untouched.

---

## 3. Storage

```
ingest_token  id · service · token_hash CHAR(64) UNIQUE · label · allowed_origins JSON
              · created_at · revoked_at NULL · last_used_at NULL           (not partitioned)

span          id, ts (PK) · service · trace_id CHAR(32) · span_id CHAR(16) · parent_span_id
              · name · kind · start_us · duration_us · status_code · status_message
              · gen_ai_operation · gen_ai_model · input_tokens · output_tokens · attrs JSON
              INDEX (service, ts) · UNIQUE (trace_id, span_id, ts)
              PARTITION BY RANGE (TO_DAYS(ts))                     (hand-written in the migration)
```

No foreign keys, as everywhere in this schema; `ingest_token.service` is the service's name.
`last_used_at` is written at most once a minute per token, without making the request wait.

---

## 4. Reads

Both behind the session guard; a write token is not a session.

- `GET /api/traces?service=&from=&to=[&limit=]` — `from`, `to` and `service` required. One row per
  trace with spans in the window: root name (first span ordered roots-first, then by start),
  start, duration (first start → last end), span count, status (`error` if any span failed, else
  `ok` if any said so, else `unset`), summed tokens, distinct models. Newest first, default 100,
  max 500, `truncated` when more matched.
- `GET /api/traces/:traceId?from=&to=` — every span in start order, up to 2 000, `truncated`
  beyond. The front asks for the run's own extent plus a minute either side.

Contracts in `nest-api/src/contracts/traces.ts` and `otlp.ts`; the front restates them in
`front/src/lib/interfaces/traceSpanTypes.ts`.

---

## 5. The view

`/traces`, in the rail after traffic and in the ⌘K palette. Scoped by the rail's service and the
top bar's range; `all` asks for a service. The run list (two fifths of the height, polled with
the service tiles' clock) opens the newest run by default; `?run=` pins one. The detail is the
waterfall — `buildSpanTree` from parent ids (a span whose parent never arrived is promoted to a
root and marked, never hidden; cycles cannot lose a span), flattened depth-first without
recursion, every bar positioned on the run's own timeline with a 0.5 % minimum width — and an
inspector beside it: hovering a span previews it, a click pins it.

Pure helpers with specs: `lib/spanTree.ts`, `lib/spanTimeline.ts`, `lib/traceFormat.ts`.

---

## 6. Not in this ticket

- OTLP logs and metrics, and protobuf.
- Span links. (Events and content landed in v2, §7.)
- Searching spans by attribute, or listing runs across every service.
- Any production token — the owner creates them with `pnpm token:create` (DEPLOY.md).

---

## 7. v2 — span events, and content kept apart (IKN-87 v2)

The Officina apps now send three things more: span **events** (gate verdicts and human decisions),
a **content retention** on every batch, and — at their `full` telemetry level only — **content**:
the prompts and answers themselves.

### Decisions

| | Decision | Why |
|---|---|---|
| D16 | `span_event`, day-partitioned on its **span's** `ts`, in `MANAGED_TABLES` on the log window | An event lives and dies with its span, and the trace read finds both with the same window. The event's own time is a column (`time_us`) |
| D17 | Resend key `(trace_id, span_id, event_index, ts)`; `event_index` is the position in the span's `events` as sent | A resend is the same list in the same order. Time + name would merge two evaluations of one rule at one instant |
| D18 | **Content keys are stripped at ingest**, from span and event attributes alike, plus `status.message` | Metadata keeps the log window; content keeps only what its sender allowed. A key that slipped into `attrs` would live 14 days regardless |
| D19 | `span_content` (trace, span, span `ts`, event index or −1, key, JSON-encoded value MEDIUMTEXT, `expires_at`), **not partitioned** | Lifetime is per batch, not per day, so no partition boundary lines up with it. The `expires_at` index makes the purge a range scan |
| D20 | `expires_at = ingest + min(stated, IKNOS_CONTENT_MAX_RETENTION_DAYS (30), IKNOS_RETENTION_DAYS)`; absent/malformed → 7; 0 → keep none | The sender decides, the server caps; content never outlives its span. A sender that cannot say how long is not trusted with the longest |
| D21 | `span.content_until` / `content_days`, set at ingest when content was kept | After the purge nothing of the content is left to infer from. The mark tells "expired after N days" from "metadata only" |
| D22 | Purge hourly at `:17` and at boot, `DELETE … ORDER BY expires_at LIMIT 5000`, ≤ 100 batches a pass; spans and events untouched | Short statements, no long locks; the fleet is stopped overnight so a 3 a.m. job alone would not run. The read filters `expires_at > now()` so a late purge never shows expired content |
| D23 | The detail joins the three tables in TypeScript (`assembleSpans`), not SQL | Three bounded reads by `trace_id`; a JOIN would repeat each span once per event |

### Contract additions

Events: `span.events[] = { timeUnixNano, name, attributes }`, at most 64 per span and 4 000 per
request (extra events dropped, the span kept); an event without a string name or a usable time is
skipped. Attributes have the span limits. Names read by the view: `gen_ai.evaluation.result`
(`gen_ai.evaluation.name`, `gen_ai.evaluation.score.label` = `pass`|`fail`,
`gen_ai.evaluation.score.value`, `officina.gate.rule_index`) and `officina.human.feedback`
(`officina.human.decision`, `officina.node.id`). Any other event is stored and listed.

Content keys: `gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.system_instructions`,
`gen_ai.evaluation.explanation`, `officina.human.note`, `officina.human.edit` (wherever they
appear), and `status.message` (stored as `otel.status.message`).

Resource: `officina.content.retention_days` (int ≥ 0). It is also kept as metadata
(`resource.officina.content.retention_days`).

### Reads

- `GET /api/traces` adds `failedEvaluations` and `humanFeedback` per run — a grouped subquery on
  `span_event` over the same service and window, `LEFT JOIN`ed by trace.
- `GET /api/traces/:traceId`: each `SpanRow` adds `events: { timeUs, name, attrs, content }[]` (time
  order), `content` (the span's own content keys, or `null`), `contentState`
  (`retained` | `expired` | `none`) and `contentDays`. `statusMessage` is filled from content
  while retained (or from the column, for spans stored before v2).

### The view

The run list gains a **review** column (failed gates, human decisions). A waterfall row marks its
span's evaluations and decisions after the name — ✕ n failed, ✓ n passed, ◆ n decisions, the words
in the title. The inspector adds **evaluations** (verdict chip, name, rule, score, explanation),
**human feedback** (decision, node, note, edit) and **content** (each key, JSON messages
re-indented), or a muted "Content expired after N days." / "Metadata only". Helpers in
`lib/spanEvents.ts` with a spec; the sections in `components/traces/inspector/`.
