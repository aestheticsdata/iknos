# M3 wave 2 — the alert engine and the alerts UI

**Tickets:** IKN-10 (collector), IKN-15 (UI), under epic IKN-27.
**Wave 1** — IKN-9 grouped errors and IKN-14's issues UI — shipped in `ae8732b` and is the
precedent this leans on throughout.

The tickets were written in July. Six of their premises are no longer true against the code, and
§9 says which and what replaces them. Read that section before the ticket.

---

## 1. Decisions

| | Decision | Why |
|---|---|---|
| D1 | Six rules, not eight | `ingest_lag`'s input freezes in the case it exists for (§9.4); `new_issue` duplicates the issues panel it would sit above (§9.5) |
| D2 | A rule is a const object with an `evaluate` function | `SORTS`, `MANAGED_TABLES`, `LEVELS` are all const records; a class per rule drags Nest DI into six predicates |
| D3 | Thresholds are exported consts, **stored on each alert row** | The front cannot import from `nest-api` — separate pnpm roots — so a row carrying its own threshold is the only shape the two tiers cannot disagree about |
| D4 | One open alert per `(rule_key, service)`, enforced by a generated column | MySQL has no partial unique index; a generated `open_key` emulates one honestly (§4.2) |
| D5 | Engine state lives on the row, never in memory | A pending alert is a visible card in the mockup, so it is already a row; a deploy mid-`for` resumes rather than restarting the clock |
| D6 | `alert_state_change` is day-partitioned and managed | It is a stream; `alert` is a ledger. Same split as `issue` / `issue_event` |
| D7 | Silence is a timestamp the read filters on | No expiry job, and the engine re-fires by itself if the condition still holds |
| D8 | The count reaches both readers through one chassis provider | IKN-15 requires the rail badge and the status bar to be one number; two polls of one route can still disagree by a tick |
| D9 | `disk_space` reads `host_sample`, and defines the threshold IKN-25 will import | IKN-25 has no code at all (§9.3) — the "shared source" is created here, not shared from there |
| D10 | The cadence travels on the payload, not in a config var | `AlertPage.evalIntervalMs`, the way `IssuePage` carries its sparkline axis |

---

## 2. The rules

```ts
export type Rule = {
  key: RuleKey;
  severity: Severity;              // may be overridden per observation — see disk_space
  title: string;
  /** Verbatim to the UI. Never reformulated, never translated. */
  expr: string;
  /** How long the condition must hold before `pending` becomes `firing`. 0 fires at once. */
  forMs: number;
  threshold: number | null;
  unit: "percent" | "ms" | "count" | null;
  evaluate(ctx: RuleContext): Promise<Observation[]>;
};

export type Observation = {
  service: string;
  /** `null` is **no opinion** — never "below threshold". */
  value: number | null;
  breached: boolean;
  /** Overrides the rule's own severity. Only `disk_space` uses it. */
  severity?: Severity;
};
```

| key | `expr` | `for` | severity | source |
|---|---|---|---|---|
| `health_down` | `probe_failures[90s] >= 2` | 0 | critical | `health_check` |
| `process_restart` | `increase(pm2_restarts[10m]) > 0` | 0 | critical | `process_sample` |
| `no_logs` | `absent(log_lines[15m])` | 0 | warning | `log_entry` |
| `disk_space` | `disk_used / disk_total > 85%` | 5m | warning, critical at 95% | `host_sample` |
| `error_rate` | `rate(http_5xx[10m]) > 5%` | 5m | warning | `SignalsService` |
| `latency_p95` | `p95(http_duration[10m]) > 1s` | 5m | warning | `SignalsService` |

Three of these have a trap worth writing down.

**`health_down` reads a window, not the last two rows.** A probe lands every 30 s and the engine
runs every 60 s, so `ORDER BY ts DESC LIMIT 2` on a slow pass silently steps over a pair. The
predicate is *two or more failures inside 90 s*, which is the same span `STALE_AFTER_MS` was sized
against.

**`process_restart` is a diff, not a value test.** `process_sample.restarts` is PM2's cumulative
counter as of that sample. And **a gap in rows means unknown, never zero**: when `pm2 jlist` is
unreachable the sampler writes nothing at all (`scrape.service.ts:220-233`), so an absent sample
must not read as "no restarts". Keyed on `pm2_name`, joined to `service` through `Service.pm2Name`
as `RuntimeService` already does.

**`error_rate` and `latency_p95` cover two services.** Of nineteen enabled services on ks-b, five
carry a `healthUrl` and **two** carry a `metricsUrl` (`pfa-nest-api`, `worldweathr-api`). Verified
against the live registry, not assumed. The engine iterates services that have the input the rule
needs, never the whole registry — a naive loop is a partition scan per cycle for seventeen services
with no samples. Units, because they are easy to get backwards: `errorRate.value` is a **percent on
0–100**, so the constant is `5`; `p95.value` is **milliseconds**, so it is `1000`.

---

## 3. The engine

`AlertEngine`, copied from `GrouperService` (`grouper.service.ts:102-162`): a timer field, a
boolean latch, `onApplicationBootstrap` arming `setInterval`, `onApplicationShutdown` clearing it,
and a pure `pass(now): Promise<number>` the specs drive directly. Not `@Cron` — its schedule is
class-definition metadata, so a cadence that is ever configurable cannot ride it, and
`IssuesModule`'s comment already settles the question: cron is for work at a wall-clock time, this
is work that must happen often.

```
EVAL_INTERVAL_MS = 60_000
```

Per-rule isolation is `grouper.service.ts:292-299` verbatim — a `try/catch` per rule inside the
cycle-level catch, so one rule's failure costs that rule and nothing else. This is worth stating
because the *other* scheduled job in this codebase does not do it: `MaintenanceService.execute()`'s
loops are unguarded awaits, and one table's DDL failure ends the pass for every table after it.

Each pass:

1. Build one `RuleContext` — `now`, the enabled registry, and a memoised `SignalsService` reader so
   two rules over the same service share one round trip.
2. Evaluate the six rules, collecting `Observation[]`.
3. Reconcile against the open alerts, in one statement per transition.

### 3.1 Reconciliation

For each observation:

| open row | breached | outcome |
|---|---|---|
| none | yes | insert `pending` (or `firing` when `forMs` is 0) |
| none | no | nothing |
| `pending` | yes | `occurrences++`, `last_seen_at`; promote to `firing` once `now - pending_since >= forMs` |
| `pending`/`firing` | no | `resolved_at = now` |
| `firing` | yes | `occurrences++`, `last_seen_at`, `value` |

A `null` value is not a breach and not a resolution — it is no reading, and an open alert with no
reading is left exactly as it is. This is the rule that keeps a scrape outage from silently
resolving every alert on the box.

`acked` and `silenced` are **not** states in this column; they are `acked_at` and `silenced_until`
stamps on a row that is still `firing`. An acknowledged alert is still firing — that is the point
of acknowledging it — and modelling them as states would make "acked then resolved" unrepresentable.

Every transition writes an `alert_state_change` row. That is what the modal's 6 h band is drawn
from; without it the modal can only say "firing, since 14:02", which says nothing about an alert
that has been flapping all afternoon.

### 3.2 The extension point

```ts
export interface AlertSink {
  onFiring(alert: FiredAlert): Promise<void>;
}
```

One implementation, `NoopSink`, and the engine awaits it inside the per-rule `try`. IKN-10 asks for
the seam so a Telegram or e-mail channel lands later without touching the engine; an interface and
a no-op is the whole cost.

---

## 4. Data model

### 4.1 Tables

`alert` — unpartitioned, kept indefinitely, like `issue`.

```
id, rule_key, service, severity, title, expr,
threshold, unit, value,
state ('pending'|'firing'|'resolved'),
opened_at, pending_since, fired_at, resolved_at,
acked_at, silenced_until,
occurrences, last_seen_at,
open_key  -- generated, see below
```

`alert_state_change` — day-partitioned, `@@id([id, ts])`, in `MANAGED_TABLES`.

```
id, ts, alert_id, from_state, to_state, value
```

The migration hand-writes the `PARTITION BY RANGE (TO_DAYS(ts))` clause and the generated column;
Prisma can express neither, and this is the same hand-edit `issue_event`'s migration already
carries.

### 4.2 One open alert per rule per service

```sql
open_key VARCHAR(96) AS (IF(resolved_at IS NULL, CONCAT(rule_key, '|', service), NULL)) STORED,
UNIQUE KEY alert_open_key (open_key)
```

MySQL 8 has no partial unique index and Prisma cannot express one. NULLs are distinct in a MySQL
unique index, so a closed row's `NULL` never collides while two open rows for the same rule and
service collide exactly when they should. The invariant is the database's, not the engine's — the
same argument `issue.fingerprint` and `app_user.singleton` already make. The engine is
single-threaded and could enforce it by construction; a guarantee that survives a second writer is
worth the generated column.

---

## 5. API

| Route | Returns |
|---|---|
| `GET /api/alerts?state=&severity=&service=&rule=&cursor=&limit=` | `AlertPage` |
| `GET /api/alerts/counts?service=` | `AlertCounts` |
| `GET /api/alerts/:id` | `AlertDetail` |
| `GET /api/alerts/:id/history?hours=` | `AlertHistory` |
| `POST /api/alerts/:id/ack \| resolve \| silence` | `{ ok: true }` |

`counts` is declared before `:id`, the lesson `logs.controller.ts:98-103` and
`issues.controller.ts` both already record.

**Keyed on `id`, unlike issues.** An issue's fingerprint is a stable public identifier a reader
pastes into the palette; an alert is an episode with a beginning and an end, and two episodes of
the same rule on the same service are genuinely different rows. There is nothing to key on but the
id.

`AlertPage.evalIntervalMs` carries the cadence, so the modal's "evaluated every 60 s" is read from
the server rather than copied into the browser. That is D10, and it is the honest form of the
ticket's "configuration value the UI reads": the number has one home and travels as data.

The mutations need nothing added to the controller — `SessionGuard` demands the CSRF header on
every method that is not safe.

Contracts in `nest-api/src/contracts/`: `alert-row.ts`, `alert-page.ts`, `alert-detail.ts`,
`alert-history.ts`, mirrored by hand into `front/src/lib/alertTypes.ts`. There is no shared package
and there never was (§9.6).

---

## 6. Front

**The card.** `flex-none` above the issues card in the right column `WorkArea` already builds, per
the mockup's split. Same three empty states `IssuesPanel` insists on — loading, failed, nothing —
never collapsed into one.

**The view.** `/alerts` under `(app)`, grouped by severity with critical first and always visible.
Filters in the URL. `ROUTES` gains `alerts`; it does not join `LOG_QUERY_VIEWS`.

**The modal.** Four tiles — state, service, current value, threshold — the 6 h history band, and
links out to the logs of the period. Derived-open, no `closeOnBackdropClick`: these carry real
actions, which is exactly what `Modal.tsx:34-42` reserves that default for.

**The count.** `AlertsProvider`, mounted once in `AppChassis` beside the issues overlay, polling
`/api/alerts/counts`. Two readers: the rail's `alerts` badge and a new status-bar cell. This is the
`useCollector` shape the wave-1 spec earmarked for wave 2, and it is what makes "the same number in
two places" structural rather than lucky.

Two things in the chrome change shape:

- The rail's badge is drawn by a literal `view.key === "issues"` ternary. A third view forces that
  into a small `VIEWS` rework rather than a third branch.
- `StatusBar` has no interactive element today — every cell is a `<span>`. The alert counter is its
  first `<button>`, and it keeps the bar's `h-6` / `text-kicker` metrics.

Nothing renders while a count is unknown. A `0` is a claim.

---

## 7. Testing

Colocated specs for the pure half: the reconciliation table above as a state-machine spec (open,
duplicate, promote on `for`, resolve, ack, silence, expiry, reopen after ack), each rule's predicate
against synthetic rows, and the units (`5` not `0.05`, `1000` not `1`).

E2E against real MySQL, following `issues-api.e2e-spec.ts`: the generated column actually refusing a
second open row, a condition held across three passes producing one row with `occurrences` at 3,
automatic resolution, silence expiring, the history band, and the CSRF 403.

---

## 8. Out of scope

Notifications of any kind, escalation, pre-scheduled silences, rules authored from the UI.
`ingest_lag` and `new_issue` — see below. Moving `StoragePanel` out of the rail (§9.7).

---

## 9. Where the tickets are stale

**9.1 "Tous les seuils viennent de la configuration, pas du code."** `Config` has ten keys and none
is a threshold. Every threshold in this product is an exported const with a colocated spec, and the
wave-1 design doc states that as the deliberate pattern. Read literally the ticket would also move
`STALE_AFTER_MS`, `LAG_WARN_MS`, `LOOP_LAG_FULL_MS`, the issue recency tiers and the rate-limit
ceilings. Each env knob is a five-file edit by written contract. **Replaced by D3** — consts, and
the threshold stored on the row so the UI never redeclares it.

**9.2 "La cadence est une valeur de configuration, lue aussi par l'UI."** No cadence anywhere is
config, and no route serves one; the only config value that crosses the wire is `retentionDays`,
which the UI does not render. **Replaced by D10.**

**9.3 "Les seuils de `disk_space` sont la même source que ceux qui colorent le panneau machine
(IKN-25)."** IKN-25 exists only as prose — no component, no route, no contract, no hook. No disk
percentage is computed anywhere in the repo and `host_sample` has never been read back by anything.
IKN-10 **creates** the constant; the requirement is a constraint on IKN-25 when it arrives.

**9.4 `ingest_lag`.** `writer.ts:228` assigns `lagMs` only after `persist()` succeeds, and the
failure path at `:198` returns early — during a database outage the lag freezes at its last healthy
reading and the rule stays silent, in precisely the case it exists for. The signal that does catch
it is "queued is rising and nothing has committed for 30 s", which today lives only in the browser
bundle as `isWriteStalled`. **Dropped**; moving that predicate server-side is its own ticket.

**9.5 `new_issue`.** The alerts card and the issues card are stacked in the same rail, so an info
alert reading "new error type" would sit directly above the panel listing that error type. It is
also the most expensive of the eight: `issue` has no index on `first_seen`, is unpartitioned and
kept forever, so it needs either a watermark row or a change to the grouper's `upsert`, which
currently discards the affected-rows count that distinguishes an insert from an update.
**Dropped.**

**9.6 "DTO dans le package partagé."** There is no shared package. Independent pnpm roots, no
tsconfig alias reaching `nest-api`, and the stated convention is authoritative types in `contracts/`
hand-mirrored into `front/src/lib/*Types.ts`.

**9.7 "La vue Alerts partage l'écran avec le panneau Storage & retention."** `StoragePanel` is not
free-standing — it lives inside `IngestCard` in the rail behind a disclosure, fed by
`useCollectorStorage(open)` which fetches only while open. Its own header says it is parked there
until the alerts view exists. Moving it is real work with no user-visible gain in this wave;
**deferred**, and the comment stays honest.

**9.8 Retention.** The four metric/health/host/process tables ride `IKNOS_METRIC_RETENTION_DAYS`,
default **3**. No rule window and no history band may assume raw rows older than that. The 6 h band
is well inside it; the note is here so the next person widening a window checks.

---

## 10. Open items

1. `alert_state_change` needs a throttle if a rule flaps every pass — `EventCap` is the ready-made
   per-key per-minute ceiling and is reused if it turns out to be needed, not pre-emptively.
2. `front/src/text/pending.spec.ts` asserts `PENDING_COPY.length === 9` and never registered
   `ISSUES_TEXT.loading` — the list is already one short. An `ALERTS_TEXT` pending string needs the
   entry *and* the bump; wave 1's miss is fixed in the same commit.
