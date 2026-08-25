# Iknos — M3 wave 1: grouped errors, and the right-hand column

**Date:** 2026-08-25
**Status:** approved
**Tickets:** IKN-9 (collector: fingerprint grouping), IKN-14 (UI: issues panel, view, modal, API)
**Epic:** IKN-27 — M3
**Companions:** `2026-08-09-iknos-ui-design.md` §4, §5.4, §5.6, §8.7 · `2026-08-10-iknos-nestjs-api-design.md` §4, §5.3

---

## 1. Why this document exists

The prototype has a right-hand column carrying two panels — alerts on top, grouped errors
below. Neither has ever existed in the app, because nothing writes the rows they would show:
`schema.prisma` has no `Issue`, no `Alert`, and the two collector tickets that own those
migrations are untouched.

This document designs **wave 1 only**: grouped errors, end to end. The collector's
fingerprinting (IKN-9), the API that serves it, and the three surfaces IKN-14 specifies —
the rail panel, the full view, the detail modal. Alerts are wave 2 (IKN-10 + IKN-15) and get
their own document; the only thing this one owes them is a column with room in it.

The panels the reader actually asked about are one third of each ticket. They are also the
part that cannot be built first, which is why this document starts underground.

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Fingerprint in the writer's post-commit loop | The only place that already sees every committed record exactly once, on the success path only. §4.1. |
| D2 | Both write paths hooked, not just the tailer | `http-ingest.service.ts` bypasses the Writer entirely, and browser-reported errors are what an issues list is for. §4.2. |
| D3 | `issue` unpartitioned, `issue_event` partitioned by day | Identity is permanent, occurrences are a stream under retention. The split is IKN-9's own §5. |
| D4 | No `log_id` column on `issue_event` | `createMany` returns no ids on MySQL. A column nobody can fill is worse than an absent one. §3.3. |
| D5 | Fingerprint is `CHAR(16)`, unique, and includes the service | Makes "one issue per fingerprint" a database guarantee rather than a race, and lets the grouper be one upsert. §3.1. |
| D6 | Per-issue-per-minute event cap in process memory | A Redis or MySQL round-trip per error line during an error storm is the storm. §4.3. |
| D7 | A new one-series contract for the occurrence chart | `Histogram` is `{t, error, warn, info}` by construction; two permanent zeros is a shape-lie. §5.3. |
| D8 | The right column is `display:none` below `--breakpoint-rail`, never folded | A folded column would need an animatable gap, which §6.1 forbids. |
| D9 | The dot scale is recency, not volume | The panel is four rows sorted by last-seen; a volume scale paints them all one colour on a bad day. §6.4. |
| D10 | `⌘I` fires from the list, never from the modal | Every non-`esc` key is dead while a modal is open, and since IKN-60 the row detail *is* a modal. §6.6. |
| D11 | Wave 1 ships the issues card alone, with no alerts placeholder | UI spec §4: panels whose data does not exist are absent, not faked. |

## 3. Data model

Two tables, in one additive migration owned by IKN-9. Both follow the schema's existing law:
camelCase in Prisma, snake_case in MySQL, an explicit `@map` on every multi-word field, a
singular `@@map`, no Prisma enums, no foreign keys, and `@db.DateTime(3)` on every timestamp.

### 3.1 `issue` — identity, and why it is unpartitioned

```prisma
/// One grouped error — IKN-9. Kept indefinitely; its occurrences are not.
model Issue {
  id            Int      @id @default(autoincrement())
  fingerprint   String   @unique @db.Char(16)
  service       String   @db.VarChar(64)
  type          String?  @db.VarChar(255)
  message       String   @db.Text
  culprit       String?  @db.VarChar(255)
  level         Int      @db.SmallInt
  levelName     String   @map("level_name") @db.VarChar(16)
  status        String   @default("unresolved") @db.VarChar(16)
  regression    Boolean  @default(false)
  firstSeen     DateTime @map("first_seen") @db.DateTime(3)
  lastSeen      DateTime @map("last_seen") @db.DateTime(3)
  eventCount    Int      @map("event_count") @default(0)
  firstRelease  String?  @map("first_release") @db.VarChar(64)
  lastRelease   String?  @map("last_release") @db.VarChar(64)
  sample        Json?

  @@index([service, lastSeen])
  @@index([status, lastSeen])
  @@map("issue")
}
```

`id Int`, not `BigInt`: the composite `(id, ts)` primary key that every other table carries
exists solely because MySQL requires the partitioning column in every unique key
(`schema.prisma:123-126`). Copying it onto an unpartitioned table would be cargo cult. `Int`
also keeps the id out of the BigInt-in-JSON problem the row mappers exist to solve.

`fingerprint` is `CHAR(16)` by the argument `metric_sample.labels_hash` already records at
`schema.prisma:150-152` — a fixed-width hex identity column is indexable in a way a JSON blob
is not, and is not collation-dependent. **The service is part of what is hashed**, so a single
`@unique` carries the whole identity and the grouper becomes one
`INSERT … ON DUPLICATE KEY UPDATE`. That is the `app_user.singleton` argument
(`schema.prisma:48-55`) applied to a second invariant: "one issue per fingerprint" should be a
guarantee the database enforces, not a `count()` two concurrent collector batches race for.

`status` is `VarChar(16)` holding `unresolved` | `resolved` | `ignored`, never a Prisma enum —
the schema has none, and `process_sample.status` is the precedent. The three values are the
mockup's own words, carried down to the column. IKN-9 says why: a column named `open` and a
filter labelled "unresolved" eventually produce a filter that does not filter.

`regression` is its own boolean rather than a fourth status. A regression is an `unresolved`
issue with a history, and collapsing it into the status column would make it invisible to the
`unresolved` filter — which is the one filter it most belongs in.

`firstSeen` is written at creation and **never touched again**. The view shows it as "since
when", and a value that slides makes that column useless.

### 3.2 `issue_event` — the stream

```prisma
/// One occurrence — IKN-9. Partitioned by day and pruned; see maintenance.
model IssueEvent {
  id      BigInt   @default(autoincrement()) @db.UnsignedBigInt
  ts      DateTime @db.DateTime(3)
  issueId Int      @map("issue_id")
  service String   @db.VarChar(64)
  traceId String?  @map("trace_id") @db.Char(32)
  release String?  @db.VarChar(64)
  message String   @db.Text
  stack   String?  @db.Text
  attrs   Json?

  @@id([id, ts])
  @@index([issueId, ts])
  @@index([service, ts])
  @@map("issue_event")
}
```

`issueId` is a plain indexed column, not a `@relation`. The schema has no foreign keys
anywhere, and InnoDB would refuse one on a partitioned table regardless.

The migration is generated with `--create-only`, then hand-edited to append the partition
clause verbatim, exactly as the metrics migration did:

```sql
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  PARTITION BY RANGE (TO_DAYS(`ts`)) ( PARTITION p_future VALUES LESS THAN MAXVALUE );
```

Only `p_future` at creation, so the table is writable from the first insert and the sliding
window is maintenance's problem. The migration file opens with the ticket name and repeats the
warning that Prisma will silently drop this clause if the file is ever regenerated.

### 3.3 The column that is not there

An earlier reading of this design gave `issue_event` a `(logId, logTs)` pair "pointing back at
the log line". It cannot exist. `writer.ts:84-97` persists with
`db.logEntry.createMany({ … })` inside the array form of `$transaction`, which on MySQL returns
no generated ids, and `ingest.service.ts:55` wraps exactly that as the Writer's only persist
closure. Every row the collector wrote would carry `log_id = NULL`, which is worse than an
absent column: it is a column that looks answerable and never is.

The pointer back is **`(ts, service, traceId)`**. That is not a compromise — it is what the
correlated-logs link needs anyway, because `GET /api/logs` refuses a request without bounds
(IKN-19) and therefore wants a window around the occurrence rather than a row id.

### 3.4 Retention, and two off-by-one bugs waiting in the existing code

`issue_event` joins `MANAGED_TABLES` in `maintenance.service.ts:17`. That single edit is the
whole wiring for its retention — the `information_schema` query and the drop loop both read
the same array. Two things must be fixed in the same commit, or the migration ships a lie:

1. **`retentionFor(table)` at `maintenance.service.ts:188-191` is a binary ternary** —
   `log_entry` gets the log window, everything else gets the *metric* window. Adding
   `issue_event` to the list silently gives an error stream a 3-day retention nobody chose.
   It becomes a per-table lookup with an explicit entry.
2. **`PRUNED_TABLE` at `storage.service.ts:31` is a single string.** The storage panel
   enumerates every base table automatically, so the day this migration lands the panel prints
   `issue_event · ∞` for a table being dropped nightly. `PRUNED_TABLE` becomes a Set, and the
   panel reads a window per table.

`issue` itself is never pruned and never partitioned: an issue whose last occurrence aged out
still answers "when did this first appear", which is the column people open the view for.

## 4. The collector — IKN-9

### 4.1 Where it hooks

In `Writer.flush`'s post-commit loop (`writer.ts:220-225`), after the early return at `:202`.

Three properties of that site make it the right one, and all three are already written down in
comments there:

- It runs **after** the transaction commits (`writer.ts:223` — *"Publish only after the commit,
  so live tail never shows a rolled-back row"*). An issue counted from a rolled-back batch
  would be a count nobody can reconcile against the logs.
- It runs **only on success**. `writer.ts:208-210` records that a failed batch returns to the
  front of the queue and is counted when it lands; counting it earlier would double it. The
  fingerprint hook inherits that for free by sitting below the early return.
- **Dropped lines are never seen**, deliberately. `writer.ts:166-168` — *"Dropped means
  dropped, and counted."* An issue built from a line the queue discarded would inflate a
  counter against logs that do not exist.

The alternatives were weighed and rejected. A periodic sweep over `log_entry` re-reads a
partitioned table the process just wrote and needs its own high-water mark. A `LogBus`
subscriber is cheaper to write but breaks `stream.e2e-spec.ts`, which asserts
`bus.listenerCount()` is 0 at rest — and the bus is a fan-out for the live tail, not a work
queue.

### 4.2 Both paths

`http-ingest.service.ts:76-79` is a second write path with its own post-commit emit loop and no
Writer at all. It gets the same hook. Browser-reported JavaScript errors are precisely the
population an issues list exists to group, so a fingerprinter wired only to the tailer would
miss the most interesting half.

### 4.3 The fingerprint

`sha1(service + "\0" + type + "\0" + normalisedFrames.slice(0, N))`, truncated to 16 hex
characters.

**Normalisation is the whole ticket.** Releases deploy to
`/var/www/<app>/<pkg>-releases/<hash>/`, so a raw stack changes on every deploy. Without
normalisation each deployment doubles every issue and the counters stop meaning anything. Two
rules:

- Release-root prefixes are stripped to a project-relative path.
- Line and column numbers inside `node_modules` frames are dropped — a dependency bump moves
  them without the error changing.

An error with no stack falls back to `service + type + normalisedMessage`, where numbers,
UUIDs and long identifiers become wildcards.

Both rules live in a pure module with a colocated spec. They are the two functions in this
ticket most likely to be quietly wrong for months.

### 4.4 The cap

An error in a render loop must not fill the disk with `issue_event` rows. The cap is
**events per issue per minute**, above which `eventCount` keeps incrementing exactly while the
event row is skipped. The counter is a fixed ring indexed by `minute % WINDOW`, reset on
revolution — the shape `rate-window.ts:32-59` already uses, kept in process memory.

Not Redis, and not a MySQL check. `ingest.service.ts:13-18` and `rate-window.ts:1-14` both
record the reason collector-facing numbers live in memory: *a status route that queries MySQL
goes silent exactly when MySQL is the problem.* A per-line round-trip during an error storm is
the error storm.

The count stays exact and the sample set is capped — the same trade `writer.ts:156-163` makes
when it pro-rates a truncated chunk's bytes rather than carrying a length per record.

### 4.5 Regression

An occurrence arriving for an issue whose status is `resolved` sets `status = "unresolved"`
and `regression = true` in the same upsert. Nothing resets `regression` except an explicit
resolve from the UI. `firstSeen` is untouched, as always.

## 5. API — IKN-14's half

A new `IssuesModule`, its own `@Controller("api/issues")`, path alias `@issues/*`, registered
in `app.module.ts`. The sentence at `app.module.ts:26` — *"Issues and alerts arrive with the
milestone that needs them"* — is rewritten to name the tickets, matching how the line above it
enumerates everything shipped.

### 5.1 Routes

| Route | Returns |
|---|---|
| `GET /api/issues?service=&status=&sort=&cursor=&limit=` | `IssuePage` |
| `GET /api/issues/counts?service=` | `{ unresolved, resolved, ignored }` |
| `GET /api/issues/:fingerprint` | `IssueDetail` |
| `GET /api/issues/:fingerprint/occurrences?from=&to=` | `OccurrenceSeries` |
| `POST /api/issues/:fingerprint/resolve` \| `/ignore` \| `/reopen` | `{ ok: true }` |

**The fingerprint is the public identifier, not `issue.id`.** The integer id exists so
`issue_event.issue_id` can be a narrow indexed column; it never appears in a route, a contract
or a URL. The fingerprint is already stable, already unique, already what the panel prints on
the row, and already what a reader would paste into the palette — routing on the id instead
would mean the one identifier on screen is not the one the address bar carries.

Literal segments (`counts`) are declared **before** `:fingerprint` in the class — the lesson
`logs.controller.ts:98-103` already records. The list is keyset-paginated with the existing
`encodeCursor`/`decodeCursor` and `escapeLike`, not a second implementation.

`counts` is its own route because the three filter segments show a count beside each label,
and a segment count read off the current page would be the length of the page.

The mutations need nothing added to the controller: the session guard already enforces the
CSRF header on every non-GET.

### 5.2 Contracts

`contracts/issue-row.ts`, `issue-page.ts`, `issue-detail.ts`, `occurrence-series.ts`, exported
from `contracts/index.ts` in alphabetical position. Row mapping follows `logs/row.ts` exactly:
a `RawIssueRow` type, `ISSUE_COLUMNS` and `ISSUE_DETAIL_COLUMNS` as `Prisma.sql` constants with
the detail list expressed as the row list widened, and a `toIssueRow` doing the BigInt→string
and Date→ISO conversion at one seam.

`contracts/search.ts` widens `SearchHitType` to include `"issue"`, and the paragraph explaining
that `issue` is *"deliberately absent rather than empty"* is **replaced, not deleted** — it
names the ticket that redeems it, and that sentence is now history rather than a promise. The
front's mirror at `searchTypes.ts:12-15` changes with it.

`search.service.ts:40-60` gains a fourth source. It belongs on the **unbounded** side beside
`services()`, not the windowed side: `issue` is unpartitioned and a fingerprint search that
only looked inside the current range would miss the issue whose whole value is that it is old.

### 5.3 The occurrence series

`OccurrenceSeries = { from, to, bucketMs, counts: number[] }`.

Not `Histogram`. That type is `{ t, error, warn, info }` by construction — three counts split
by pino level — and an issue's occurrences are one series by definition. Sending them as
`error` with two permanent zeros is exactly the shape-lie `contracts/histogram.ts` argues
against, and `BarSpark` already draws the single-series case, including its dimmed stub for a
measured zero and its nothing-at-all for a null.

## 6. Front — IKN-14's three surfaces

### 6.1 The column

`WorkArea.tsx:171` is today the single growing child holding `LogPanel`. It becomes a row, with
`flex-1` moving down one level:

```tsx
<div className="flex min-h-0 flex-1 gap-2.75">
  <div className="min-w-0 flex-1 overflow-hidden rounded-card border border-chassis-border">
    <LogPanel services={services} />
  </div>
  <aside className="flex w-[296px] min-h-0 flex-none flex-col gap-2.75 max-rail:hidden">
    …
  </aside>
</div>
```

Nothing above it changes. `WorkArea`'s own `flex h-full min-h-0 flex-col` already gives the row
a definite height, and `min-h-0` on the row is what lets it shrink below its content and hand
the overflow inward rather than pushing the status bar off the screen — the one thing
`AppChassis.tsx:19-23` says the layout must never do.

296px and the 11px gap are the mockup's own numbers.

**The horizontal `gap` is legal here, and only here.** `WorkArea.tsx:70-77` forbids a gap on an
axis where a child folds, because a gap is not a property of anything and cannot be
transitioned. This column does not fold: below `--breakpoint-rail` it is removed outright with
`max-rail:hidden`. If it ever gains a fold, the 11px moves onto the column as a margin at the
same time.

The column exists only when the rail has a service selected. `WorkArea.tsx:59` returns a bare
`LogPanel` for the fleet-wide explorer, with no ground and no padding, and the prototype agrees
— it draws the panels for the service and alerts views and nowhere else. A right column beside
a fleet-wide log stream would be answering a question about a service nobody picked.

Inside the aside, wave 1 mounts one card: `flex min-h-0 flex-1 flex-col overflow-hidden`, its
list the only scrolling child via `SURFACE_SCROLL.work`. Neither panel sets a height in pixels;
the `min-h-0` chain does the work. Wave 2's alerts card lands above it as `flex-none`, sized by
its content, per the mockup's split.

**No empty alerts slot in wave 1.** UI spec §4: *views and panels whose data does not exist yet
are absent, not faked.*

### 6.2 The panel

Per row, from the mockup: severity dot, fingerprint chip, count, last-seen, type, a 52×14
sparkline, and the message clamped to two lines. Four rows at most — IKN-14 says a rail that
scrolls everything is not a rail — then a footer reading `N more unresolved · open Issues →`.

Three empty states, never collapsed into one: **no unresolved issues**, **could not read
them**, and **nothing has arrived yet**. `Signals.tsx:366-383` names collapsing those as the
one thing a monitoring tool must never do, and an issues panel is the place it would be most
tempting.

`Card` gains a `bare` (or `bodyClassName`) prop. Its body is a fixed `p-3` div with no way to
run a list flush to the card edges or to make it `min-h-0 flex-1 overflow-y-auto` — which is
exactly what this panel is. This is `Card`'s first use outside the design gallery, and
`DenseTable`'s doc comment has named "issue lists" as its intended caller since it was written.

### 6.3 The view and the modal

`/issues` as a new page under `(app)`, inheriting the chassis, the session boundary and
`force-dynamic` for free. `ROUTES` gains `issues: "/issues"`. It does **not** join
`LOG_QUERY_VIEWS` — that list is "the views that read the log query out of the URL", and this
one does not; adding it would let the ⌘K palette write filters onto a page that never reads
them.

The table is the mockup's columns, with `RELEASE` showing `—` rather than being dropped when no
release marker exists (§8.7: the layout must not change the day it starts working). Filter
segments and sort live in the URL.

The modal is five stat tiles, the 48h occurrence chart, and the latest stack. It sets **no**
`closeOnBackdropClick` — `Modal.tsx:34-42` turned that default off for these exact callers:
*"These carry real actions — acknowledge an alert, close an issue — and a stray click beside
the card should not be one of them."* It is derived-open, never `{open && <Modal/>}`, or the
200ms exit never plays.

The correlated-logs link is the point of the modal. `logsHref` cannot express it today:
`LOG_FILTER_KEYS` has no `trace`, and the trace is a separate `?trace=` param. The builder
widens to carry it, with the bounded window IKN-19 requires. This is the only Done item in the
ticket blocked by a type signature.

### 6.4 The dot

The mockup's four tones are undefined anywhere in the tickets. They are **recency**:

| Tone | Last seen |
|---|---|
| error | under 15 min |
| warn | under 1 h |
| info | under 24 h |
| ok | beyond |

Volume was the other candidate and is wrong for this surface. The panel is four rows sorted by
last-seen; on a bad day the top four all have large counts and a volume scale paints them one
colour. "What is happening right now" is the question a rail answers, and the count is already
on the row in figures.

The thresholds are exported constants with a colocated spec, for the reason `service-rail.ts`
exports `STALE_AFTER_MS`: two renderings of one state must not be able to disagree.

### 6.5 Data

`useIssues(service, status, active)` over `usePolledResource`, gating the **URL** and never the
identity — `useServiceView.ts:75-85`. The poll cadence is derived from the writer's flush
interval rather than picked, the way `RUNTIME_POLL_MS` is derived from the scrape interval. The
occurrence window is **server-chosen**, so the URL is stable and the panel does not blank to
"reading…" on every re-anchor.

`postWithCsrf` widens into a `mutateWithCsrf<T>(path, { method, data })` carrying a body and
returning a response; `postWithCsrf` stays as a thin wrapper so `useLogout` is untouched.
Failures read through `readApiError` and surface as a toast — `ToastProvider` already wraps the
entire chassis, so nothing needs mounting.

Mutations are optimistic with a rollback on failure, per IKN-14.

### 6.6 Keyboard, palette, rail

**`⌘I`** does not exist: `keymap.ts` has no `i` branch and no `issue` member in `CommandName`.
It binds to the **selected row in the list**. It cannot work anywhere else — `keymap.ts:67`
returns null for every non-`esc` key while a modal is open, and since IKN-60 the row detail
*is* a modal. The modal reaches its issue through a button in the footer, where `RowDetail.tsx`
has held the slot open since it was written. `CHASSIS_TEXT.keyLegend` gains `⌘I`, which it has
deliberately omitted until now because a legend advertising a dead key is worse than a short
legend.

**The palette** widens by three edits, not one. `ACTION` at `CommandPalette.tsx:41-46` is
`Record<SearchHitType, string>` and fails the typecheck the moment the union grows — which is
the intended behaviour and the nearest thing this codebase has to a compile-time TODO. The
`act` switch at `:101-119` needs an `issue` branch, or the hit silently does nothing. And
`:125` redirects any non-`view` hit to `/logs` when the current path is not a log-query view,
which would eject a reader who picked an issue *from the issues page*; the branch needs its
exemption.

**The rail** gains an `issues` row in `VIEWS`. Its badge stops being a shortcut letter and
becomes live data — a change of kind, not of value. Wave 1 uses the unresolved count from the
same `counts` route the filter segments read, **scoped to the rail's own selection**: the rail
says its selection re-scopes every view, and a badge that stayed fleet-wide while everything
beside it narrowed would be the one number on screen answering a different question. With `all`
selected it is the fleet count.

Wave 2's alert badge has a harder constraint — IKN-15 requires the rail badge and the status-bar
counter to be one number from one route — and will introduce the chassis-level provider for it,
the `useCollector` shape. This wave does not need one: the issues badge has a single reader.

## 7. Testing

Colocated `*.spec.ts`, pure functions only, matching what the suite already does:

- stack normalisation across two release paths, and fingerprint stability under a deploy
- the no-stack message fallback
- the per-minute cap ring: count exact, samples capped
- the recency dot thresholds
- issue row mapping (BigInt→string, Date→ISO)
- cursor round-trip for the issues list

E2E follows `ingest-recovery.e2e-spec.ts`: construct Writer and Tailer by hand, drive
`poll()`/`flush()`, assert one issue with the right count from a hundred identical throws.
`tail-roundtrip.e2e-spec.ts` constructs `new IngestService(glob, bus, prisma)` positionally, so
any new constructor dependency updates it in the same commit.

`sustained-load.spec.ts` holds a 32 MB growth ceiling over 100 000 lines. Per-record retention
added by fingerprinting is measured there, not assumed.

New panel copy goes in a new `front/src/text/issues.ts`. Any new pending string must also be
added to the `PENDING_COPY` array **and** its hard-coded length in `pending.spec.ts:21-42`,
which fails otherwise.

`front/deploy-front.sh:123-124` claims *"the front has no suite yet … the omission is
deliberate rather than forgotten."* Fifteen `*.spec.ts` files exist under `front/src`. The
comment is now false and invites the next reader to keep skipping tests; the step joins the
list and the paragraph goes.

## 8. Out of scope

Alerts in every form — the rules engine, the alert card, the alert modal, the status-bar
counter, the rail's alert badge, and moving `StoragePanel` into an alerts view. All wave 2.

Also out, and staying out: assignment, comments, linking an issue to a Spira ticket,
notifications of any kind, cross-service grouping, and approximate similarity matching.

## 9. Open items

1. **`N` in the fingerprint's frame count.** Three is the usual answer; it wants one pass over
   real ks-b stacks before it is fixed in a constant.
2. **The release marker does not exist.** No deploy script writes one, so `first_release` and
   `last_release` are null and the column shows `—`. Correct per §8.7, but it means one Done
   item on IKN-9 cannot be demonstrated until a deploy script writes the marker.
3. **Modal-from-modal.** A log row opening its issue means two `<dialog>`s in the top layer,
   which has never run here. The safe existing pattern is sibling modals driven from URL state
   with `history: "replace"`, one closing as the other opens — `traceState.ts` does exactly
   this for `?trace=`. Decided at implementation time against a real interaction.

## 10. As built — where the implementation left the spec

Seven deliberate departures, each with the reason it was taken. Everything else shipped as
written above.

1. **`issue_event.count`, a new column** (migration `20260825150955_issue_event_count`). The
   grouper writes at most one sample row per fingerprint per pass, so counting rows draws how
   many *passes* saw an error — four a minute whether it threw four times or four thousand.
   IKN-14's Done item asks the sparkline to reflect the real distribution, which is not
   answerable without the number travelling with the sample. `SUM(count)` is what both the
   sparkline and the modal's chart read.

2. **`issues/issue-cursor.ts` rather than reusing `logs/cursor.ts`** (§5.1 said reuse it). That
   pair encodes a `Date` and an `UNSIGNED BIGINT`, because a log page is always ordered by time.
   This list also sorts by volume, where the key is `event_count` — an integer that is not an
   instant and would have to be dressed as one to fit. Two small functions that say what they
   carry beat one that lies about it.

3. **`seg=`, not `status=`, for the segment filter.** `status` is already the log list's HTTP
   status filter, and `ServiceRail`'s `withScope` carries the whole query string across views —
   so arriving at `/issues` from `/logs?status=500` would have landed on a segment filter of
   `500`, which the API refuses, correctly and confusingly.

4. **`GET /api/issues/for-log/:id` — a new route the spec did not name.** §6.6 requires `⌘I` to
   open "the issue of the selected row" and nothing in the schema links a `log_entry` row to an
   `issue`: `persistBatch` writes through `createMany` in a transaction, which returns no ids on
   MySQL, so the link cannot be stored. The route recomputes it through the grouper's own
   `coalesce` → `errorFieldsOf` → `fingerprintOf`, which is the only version that cannot drift
   from what the grouping actually did. `issues/log-link.ts`, tested without a database.

5. **The modal is mounted on the chassis, not by a list**, and the optimistic state lives one
   level higher still in `lib/issueClaims.tsx`. §6.5 put the mutations beside the list they
   change; `⌘I` fires from the log view, which has no issues list, so one modal above all three
   openers is the only arrangement where the shortcut works. The claim overlay is what keeps the
   update optimistic across that distance, and claims are settled by the next payload rather than
   by a timer — a timer either flashes the old row back or outranks the server indefinitely, and
   the second would hide a regression the collector had just reopened.

6. **The full table pages by raising `limit`, not by accumulating cursors.** The keyset is
   implemented and tested on the API; the view uses one page and raises it to the server's
   ceiling of 200. Mixing a polled head page with an accumulated tail lets the boundary shift
   under the reader between polls. At the ceiling the view *says* it is capped rather than
   silently dropping the button — a silent cap is a list claiming to be complete.

7. **The rail row's collapsed form is `IS`, not the count.** §6.6 said the badge becomes live
   data, and it does — beside the name, at full width. At 52px the badge *is* the row, and a
   number there identifies nothing.

Open item 3 is settled the way it proposed: **one closes as the other opens, through URL state.**
`⌘I` is dead while the row detail is open (`keymap.ts`), so the detail reaches its issue through
a button in its own footer — and `LogPanel` closes the detail once the lookup has succeeded, so
the two `<dialog>`s are never in the top layer together. Only on success: closing it up front
would take the panel away for nothing on a line that was never grouped, which is most lines.
