# Iknos — UI design and information architecture

**Date:** 2026-08-09
**Status:** approved
**Source:** `docs/design/iknos-prototype.dc.html` (retained mockup),
`docs/design/iknos-design-exploration.dc.html` (the exploration that produced it)
**Companion:** `docs/superpowers/specs/2026-08-10-iknos-nestjs-api-design.md` (backend)

---

## 1. Why this document exists

The backend spec describes what Iknos stores and serves. It says nothing about what the thing
looks like, and the tickets written before the mockup assumed the UI would be a port of PFA.
The mockup says otherwise, deliberately, and it also carries several features no ticket had.

This document is the reference the UI tickets point to, so the palette, the layout and the
interaction rules are stated once rather than restated twelve times and drifting.

The mockup is a static prototype: its data is hard-coded and some of its numbers are decorative.
It is authoritative on **form, layout and interaction**, not on values. Where it contradicts the
backend design, §8 records which one won.

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| U1 | Iknos gets its own visual language, built on PFA's CSS architecture | The exploration explicitly rejected PFA's look — "zéro dégradé, monospace partout". Keeping PFA's `globals.css` split, Tailwind v4 token layer and primitive inventory preserves the copy-and-own saving; the token *values* and the component skins are Iknos'. |
| U2 | The app is service-scoped | A PM2 service rail drives every view. There is no fleet-wide Overview: you pick a service and the whole screen answers about that service. Fleet-level facts (host, storage, collector) live in the chassis, not in a page. |
| U3 | Dark chassis, light work surface, dark log window | The chassis is the tool and never moves. The work surface is data you read for an hour. The log stream is the one place you are genuinely in a terminal, so it is a dark window inset into the light surface. |
| U4 | Accounts are provisioned, but recoverable | Registration is open only while no account exists and seals itself afterwards — Zeus's mechanism, enforced by a `UNIQUE` column rather than a flag. The sealed state is shown, not 404'd. Recovery is a passphrase chosen at creation: there is no mail infrastructure on ks-b and there is not going to be any. |
| U5 | Keyboard is a first-class input | `j/k`, `⏎`, `⌥⏎`, `/`, `⌘K`, `⌘L`, `⌘I`, `⌘C`, `⌘⇧L`. The status bar advertises them permanently. This is the difference between a dashboard you look at and a tool you use. |
| U6 | One screen, no page scroll | 1440×900 is the design frame. The page never scrolls; individual lists do. A monitoring screen you have to scroll to read has already failed at its job. |

## 3. Visual language

### 3.1 Two surfaces

**Chassis (dark)** — top bar, service rail, status bar, modals, auth screens.
**Work surface (light)** — cards, tables, signal tiles, route lists.
**Log window (darkest)** — the log panel, inset into the work surface with an inner ring.

A card never floats on a shadow on the light surface: it is a 1px border and a flat fill.
Elevation is reserved for things that overlay — modals, the user menu, toasts.

### 3.2 Palette

Semantic names, with the mockup's hex as the starting values. The dark and light ramps are
separate: a level colour that reads on `#10151C` is unreadable on `#BFCDD4`, so each state has
two tokens and the component picks by surface, never by luck.

| Token | Dark | Light | Use |
|---|---|---|---|
| `surface` | `#171E27` | `#BFCDD4` | bars, rail, cards |
| `surface-inset` | `#0C1117` | `#AEBFC7` | inputs, table headers, hover |
| `surface-deep` | `#10151C` | — | log window, auth backdrop |
| `surface-raised` | `#1E2733` | — | status bar, modal header, menus |
| `border` | `#27313D` | `#93A8B3` | default |
| `border-strong` | `#33404E` | `#A3B6BF` | inputs, dividers, track fills |
| `border-focus` | `#4A5F72` | — | hover and focus |
| `text` | `#CBD8D0` | `#131E24` | primary |
| `text-bright` | `#DFE9E4` | — | emphasis inside the log window |
| `text-muted` | `#8FA99A` | `#3F535F` | secondary |
| `text-dim` | `#5E7286` | `#556A76` | labels, kickers |
| `accent` | `#86B99A` | `#3C6B52` | brand, ok, live |
| `warn` | `#E0AE55` | `#8A6118` | warning level, pending |
| `error` | `#E4736B` | `#8E2F2A` | error level, firing |
| `info` | `#7FA8C4` | `#4E7B96` | trace ids, links |
| `error-bg` | `#22191C` | `#C4A9A6` | error row / hot issue background |

Histogram bars have their own three: error `#C1504A`, warn `#C89A3E`, info `#3E5A50`.

The accent is a themable prop in the mockup (`#86B99A` green, `#7FA8C4` blue, `#C2D4CB`,
`#E0AE55`). Ship the green; keep the token indirection so the other three cost nothing.

Green is the identity, not merely "everything is fine" — that is the whole reason the
exploration dropped the navy direction. Do not let a later chart use it as a neutral series
colour.

### 3.3 Typography

- **JetBrains Mono** — everything that is data or chrome: log rows, tables, metrics, chips,
  the status bar, the auth screens. Weights 400/500/700.
- **IBM Plex Sans** — card titles and prose labels only. Weights 400/500/600.
- **IBM Plex Mono** — loaded, currently unused. Drop it from the font list unless a use appears;
  three families for two jobs is a page-weight tax with no return.

Sizes run 9px (letterspaced kickers, `.14em`–`.16em`) to 20px (signal values). Log rows and
tables sit at 10.5–11.5px. This is denser than PFA on purpose.

### 3.4 Density and radii

`density: compact | comfortable` changes row padding (3px / 5px) and nothing else. Compact is
the default. Radii: 3px chips, 4–5px inputs and buttons, 8px cards, 9–10px modals.

Animations are three, all short: `ikPulse` (2s, the live dots), `ikIn` (.14–.18s, things that
appear), `ikFade` (.12–.16s, overlays). Nothing else moves.

## 4. Information architecture

```
┌─ top bar ────────────────────────────────────────────────────────────────┐
│ IKNOS · [ks-b] · services / {service} · ⌘K search · [15m 1h 24h 7d]      │
│                                    · collector lag 0.4s · clock          │
├──────────┬───────────────────────────────────────────────────────────────┤
│ SERVICES │                                                               │
│  ● pfa   │                     work surface                              │
│  ● …     │                    (view-dependent)                           │
│          │                                                               │
│ VIEWS    │                                                               │
│  service │                                                               │
│  logs    │                                                               │
│  metrics │                                                               │
│  issues  │                                                               │
│  alerts  │                                                               │
│          │                                                               │
│ INGEST   │                                                               │
│ [user]   │                                                               │
├──────────┴───────────────────────────────────────────────────────────────┤
│ NORMAL │ pfa │ tail on │ 10 464 ev / 1h │ q 38ms │ 1 active alert │ keys  │
└──────────────────────────────────────────────────────────────────────────┘
```

**Top bar** — brand, host badge, breadcrumb, command palette trigger, the **global time range**
(15m / 1h / 24h / 7d, plus a free range), collector liveness with ingest lag, clock.

**Service rail** — one row per `Service`: status dot, name, 20-point sparkline. Selecting a
service re-scopes every view. Below it the view list with a right-hand badge (a shortcut letter,
or a count for issues and alerts), then the `INGEST · 60m` card, then the user menu.

**Status bar** — mode, selected service, tail state, event count for the range, **query time**,
active-alert count (clickable), and the permanent keyboard legend.

**Views**

| View | Contains | Milestone |
|---|---|---|
| `service` | header + chips + health pills, 4 signal tiles, log panel, right rail (alerts + issues) | assembles across M1–M3 |
| `logs` | log panel, full width | M1 |
| `metrics` | routes table + route detail (percentiles, distribution, status codes) | M2 |
| `issues` | full issues table | M3 |
| `alerts` | alerts + issues + storage panels | M3 |

The chrome ships whole in M1. Views and panels whose data does not exist yet are **absent, not
faked** — no placeholder charts, no lorem numbers. A view that cannot be answered is not in the
list until it can.

## 5. Screen inventory

### 5.1 Log panel — the M1 deliverable

Top to bottom:

1. **Token query bar.** Filters are chips, not form fields: `service:pfa`, `level>=warn`, a free
   text token. Each is toggleable in place (`×` when active, `+` when not) and dimmed when off.
   Then the `● LIVE` / `❙❙ PAUSED` toggle and `⌘L fullscreen`.
2. **Volume histogram.** Stacked error/warn/info counts over the selected range, plus a marker
   on the anomaly (`▲ 02:14:37 · +18 err`). Clicking a bucket narrows the range to it.
3. **Column header.** `TIME · LVL · SERVICE · ROUTE · ST · MESSAGE · TRACE · DUR` — a direct
   projection of `log_entry`, which is why it costs nothing to serve.
4. **Rows.** Level-coloured, error rows carry a red-tinted background and a left edge, the
   selected row carries the accent edge. `traceId` is a dotted-underlined affordance.
5. **Expanded row.** Raw ECS JSON on the left, stack (for errors) or process context (otherwise)
   on the right, then three actions: `⌥⏎ trace`, `⌘I issue`, `⌘C copy NDJSON`.

### 5.2 Service view

Header: service name, emitter line (`ECS · pino + @elastic/ecs-pino-format`), chips (`pm2 id`,
node version, `release · sha`, uptime, restart count — the restart chip turns red above zero),
and health pills (`mysql 3ms`, `redis 1ms`, `/health 502`) that are clickable and open the probe
detail or the matching alert.

Four signal tiles: **throughput** (req/s + area chart), **error rate** (% + bar histogram),
**p95 latency** (ms + line with a reference dash), **node runtime** (heap, event-loop lag bar,
db-pool bar — the pool bar turns red at saturation, which is the mockup's whole scenario).

### 5.3 Metrics view

Routes table sorted by p95: `ROUTE · RATE · p50 · p95 · p99 · ERR · SHARE`, share as a bar.
Selecting a row opens the detail: p50/p95/p99 over the range, latency distribution buckets
(`<50ms`, `50–200ms`, `200ms–1s`, `>1s`), a status-code split (2xx/4xx/5xx) as a single stacked
bar with a legend, and a summary panel footnoted with the provenance —
*"scraped from /metrics every 15s · histogram buckets from prom-client"*. That footnote is not
decoration: it is what stops someone reading the p95 as a measured value rather than an
interpolated one.

### 5.4 Issues view

`FINGERPRINT · ERROR (type + message + file) · SERVICE · EVENTS·48h · COUNT · FIRST SEEN ·
LAST SEEN · RELEASE`. Filters `unresolved | resolved | ignored` with live counts; sorts by last
seen, events, first seen. Hot issues carry the error background.

### 5.5 Alerts view

The rail panels expanded: alert cards (`FIRING`/`PENDING` badge, rule expression, service,
current value, duration), the issues panel, and the **storage panel** — per-table size, retention
window and a footer line carrying the schedule (`mysql 5.1/20 GB · nightly purge 03:00 · hourly
rollup +00:07`).

### 5.6 Modals

Four, all the same shell (tag, title, `esc`, body, hint line, actions):

- **trace** — a span waterfall on `trace.id`, each row timestamp/service/operation/detail with a
  proportional bar. Actions: copy trace id, open in logs.
- **issue** — five stat tiles, a 48h occurrence histogram, the latest stack. Actions: ignore,
  resolve.
- **alert** — the rule, four tiles (state, service, current, threshold), a 6h state-history
  strip. Actions: silence 1h, acknowledge.
- **⌘K palette** — one input, results typed by kind (`SERVICE`, `ISSUE`, `ROUTE`, `VIEW`) with
  the action each one performs on the right.

Toasts confirm anything that has no visible consequence (copied, silenced, filter applied).
Bottom-right, 2.6s, one at a time.

### 5.7 Auth

Full-screen dark, oversized outlined `IKNOS` wordmark bled off the bottom-left, two radial
washes, and a chrome bar carrying `KS-B.INTERNAL` with a liveness dot. Four pages sharing one
card: **login**, **register**, **recover**, **about**.

- **login** — email, password, `Sign in` (which becomes `verifying…`), `REGISTER`,
  `RECOVER ACCOUNT →`.
- **register** — first run only. Once the account exists, an amber-edged banner *"this instance
  already has its account"* with *"use recovery if you are locked out"* underneath, and the form
  below it at 42% opacity with a dead button. Fields: email, password + confirm, a 4-segment
  strength meter, recovery passphrase + confirm (20+ chars), and the warning that there is no
  recovery email. Success opens no session and lands on login — proving the password works
  while the passphrase is still on screen to be written down.

  The seal is read on the **server** from `GET /api/auth/bootstrap`. Deciding it in the client
  would leave a window with a real, submittable first-run form on screen.
- **recover** — email, recovery passphrase, new password + confirm.
- **about** — the legal notice as a key/value list (service, host, office, APE, VAT).

Footer on every page: the product line, an `ABOUT IKNOS →` toggle, and
`httpOnly cookie · rolling session · CSRF · bcrypt`. Stating the security posture on the login
screen of a self-hosted tool is honest, and it costs one line.

## 6. Interaction rules

| Key | Action |
|---|---|
| `j` / `k` / `↑` / `↓` | move the log selection |
| `⏎` | expand the selected row |
| `⌥⏎` | open the trace of the selected row |
| `/` | focus the query bar |
| `⌘K` | command palette |
| `⌘L` | fullscreen logs |
| `⌘I` | open the issue of the selected row |
| `⌘C` | copy the row as NDJSON |
| `⌘⇧L` | log out |
| `esc` | close modal / menu |

The selection is clamped whenever filters change — a filter that empties the list must not leave
the cursor pointing past the end.

Live tail pauses the moment the user leaves the top of the list and offers
`N new lines` to resume. A stream that jumps while you are reading is worse than no stream.

## 7. What the front consumes

Everything comes from the Nest API over localhost with the session cookie forwarded. The mockup
implies these, beyond what IKN-19 already specified:

| Need | Route | Ticket |
|---|---|---|
| the register seal | `GET /api/auth/bootstrap` | IKN-21 |
| volume histogram | `GET /api/logs/histogram` | IKN-19 |
| trace waterfall | `GET /api/logs/trace/:traceId` | IKN-19 |
| query timing in the status bar | `meta.tookMs` on every list response | IKN-19 |
| service rail: dots + sparklines | `GET /api/services` enriched | IKN-19 / IKN-8 |
| collector lag, ingest rate, drops | `GET /api/collector/status` | IKN-24 |
| storage panel | `GET /api/collector/storage` | IKN-24 |
| header chips, health pills, runtime | metrics + probes | IKN-8 |
| palette search | `GET /api/search?q=` | IKN-22 |

## 8. Where the mockup is wrong, and what won

1. **`nginx` in the PM2 service rail.** nginx is not a PM2 process and its logs are not in
   `~/.pm2/logs`. The rail is right that it belongs there; the *source* is `/var/log/nginx`, and
   that is IKN-16's job. Until then the rail shows PM2 services only.
2. **Service names.** The mockup shows `iknos-collector` and `iknos-ui`; deployment names them
   `iknos-api` and `iknos-web`. The PM2 names win — the rail shows what PM2 reports. `Service`
   already carries a display `name` distinct from `pm2Name` if a nicer label is wanted later.
3. **The trace modal.** The backend spec puts distributed tracing out of scope and it stays out.
   The modal is buildable from log rows sharing a `trace.id`, ordered by `ts` and sized by
   `duration_ms` — a request timeline, not a span tree. The mockup's fifth row
   (*"iknos-collector · fingerprint · grouped into issue"*) is a real log line from Iknos itself,
   so it appears for free. Nothing else is synthesised.
4. **`4.2 GB` of logs against `14d` retention.** Decorative. The storage panel reads real table
   sizes from `information_schema`.
5. **Machine stats have no home.** CPU, memory and disk appear nowhere in the mockup, yet they
   are collected and the disk is the thing that actually kills a VPS. The `ks-b` badge in the top
   bar becomes the affordance: it opens a host panel. IKN-25.
6. **`settings` in the user menu** toasts *"not in v1 scope"* — keep it that way, and keep
   `change password` live, since IKN-21 provides it.
7. **The release chip and the issues `RELEASE` column** need a release marker per service. If
   the deploy script does not write one, the column shows `—` rather than being dropped: the
   layout should not change the day it starts working.
8. **The sealed register banner names `IKNOS_ALLOW_SIGNUP=false`.** No such variable exists.
   Registration is gated by whether the account exists — Zeus's self-sealing bootstrap, chosen
   over a flag because a flag is one more thing to forget, and one more thing to flip back on by
   accident. The banner's copy becomes *"this instance already has its account"*; the layout is
   unchanged.

## 9. Ticket map

| Piece | Ticket |
|---|---|
| tokens, primitives, chassis, auth screens | IKN-5 |
| session, CSRF, guard, login | IKN-6 |
| registration, passphrase recovery, password change | IKN-21 |
| logs API incl. histogram, trace, timing | IKN-19 |
| log panel, query tokens, live tail, expanded row | IKN-12 |
| ⌘K palette, keyboard navigation, search route | IKN-22 |
| collector status, ingest card, storage panel | IKN-24 |
| service view: header, chips, health pills, signals | IKN-13 |
| metrics view: routes and route detail | IKN-23 |
| issues view and issue modal | IKN-14 |
| alerts view and alert modal | IKN-15 |
| host panel behind the `ks-b` badge | IKN-25 |
