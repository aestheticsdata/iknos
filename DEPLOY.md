# Deploying Iknos

Nothing here deploys an application yet, because there is no application yet. What is deployed is
a **static mock** of the service view, so the design has a URL and can be argued with in a browser
instead of in a design tool.

<https://iknos.1991computer.com>

```bash
./deploy/deploy-mock.sh
```

Edit `mock/index.html`, run that, refresh. The vhost sends `Cache-Control: no-store` for exactly
this reason.

## Ports

Both slots were the last free entries in Zeus's registry, and both were verified genuinely free on
`ks-b` with `ss -ltn` before being taken — the registry records intent, not what is listening.

| | Port | pm2 name | state |
|---|---|---|---|
| front | `3006` | `iknos-front` | reserved, nothing listening |
| api | `6900` (block `6900–6999`) | `iknos-api` | reserved, nothing listening |

**Registered in Zeus on 2026-08-15.** Both rows read *not running*, in red — that is the correct
state, not a defect to chase: the ports are reserved, nothing is listening yet. `IKN-4` turns them
green.

Registration also makes the registry the contract, so the deploy has to match it or the dashboard
shows drift: `6900` **exactly** (Zeus flags any api whose port is not a multiple of 100), `3006`,
the two pm2 names above, and `/health` **outside** `/api`. Zeus probes the front root with
`redirect: "manual"`, so a 307 there counts as up.

The registered `ecosystemPath` of `/var/www/iknos/ecosystem.config.js` is correct and needs no
change. Every sibling has exactly one such file at its application root, `chmod 600`, and it
declares the **API only** — `/var/www/zeus/ecosystem.config.js` names `zeus-nest-api` and nothing
else. The front is not in an ecosystem file at all: `zeus-front` is `next start -p 3003 -H
127.0.0.1` run with `cwd=/var/www/zeus/public_html`, and spira and trekker are identical bar the
port.

## What the box will look like

Read off ks-b, not invented. Every sibling has this, and Iknos gets the same:

```
/var/www/iknos/
  nest-api/              live API — the api process's cwd
  nest-api-releases/     timestamped releases
  nest-api.bak/          the previous release, kept for rollback
  public_html/           live front — the front process's cwd (today: the mock)
  public_html.bak/
  deploy-logs/
  ecosystem.config.js    chmod 600, secrets, declares iknos-api
```

Rollback is a directory swap, which is why `.bak` is a sibling of the live directory rather than a
tarball somewhere: the deploy script moves the live copy aside before moving the new release in,
and on any failure after that point it moves it straight back and reloads. Nothing to unpack, and
the previous version is always one `mv` away.

**Today only `public_html` exists**, holding the mock. The deploy script creates the rest on its
first run — and `public_html` is not removed when the mock goes, it is where the front deploys.

⚠️ **No `dbName` recorded yet**, because there is no schema until the first Prisma migration
(`IKN-3`). Until it is set from Zeus's `/backups` page, **Iknos is excluded from the nightly
database dumps** — a live instance with no backup is a worse state than no instance, so this is a
step of the first deploy, not a follow-up.

One side effect worth knowing: Zeus rejects a deploy report from an unregistered app with a 400, so
`deploy/deploy.sh` can report its deploys from the first run.

## The machine

`ks-b` — `51.75.118.52`, reached as `ssh ks-b`. Runs every app in the fleet under pm2 behind one
nginx. Iknos will eventually read its PM2 logs, which is why it lives on the same box rather than
somewhere tidier.

## What is already set up

Done on 2026-08-15, one-time:

- `/var/www/iknos/public_html`, owned by `debian`
- its own certificate — `sudo certbot certonly --webroot -w /var/www/letsencrypt -d iknos.1991computer.com`,
  expires 2026-11-13 and renews on certbot's own timer. Separate from the shared `1991computer.com`
  certificate, same reasoning as zeus and trekker: a renewal for one site should not put the others
  in the blast radius.
- `/etc/nginx/conf.d/iknos.conf`, from [`deploy/nginx/iknos.conf`](deploy/nginx/iknos.conf)

DNS already resolved before any of this — `iknos.1991computer.com` → `51.75.118.52`.

## Installing a vhost change

The file in this repo is the source; the copy on `ks-b` is a copy. Never edit the server one.

```bash
scp deploy/nginx/iknos.conf ks-b:/tmp/iknos.conf
ssh ks-b 'sudo cp /tmp/iknos.conf /etc/nginx/conf.d/iknos.conf && sudo nginx -t'
ssh ks-b 'sudo systemctl reload nginx'
```

**Run `nginx -t` before the reload, always, and read its output.** One nginx serves nine sites here;
a bad file in `conf.d/` is everyone's problem, not just Iknos'. `nginx -t` currently emits two
`conflicting server name ""` warnings — those come from `minimal-certbot.conf`, predate Iknos, and
are not a signal about your change.

## Leaving the mock phase

`location /` in the vhost currently serves static files. When `iknos-front` starts listening on 3006,
the switch is two marked edits in that file: delete the block between the `MOCK PHASE` banners, and
uncomment the proxy blocks below it. The SSE block for `/api/logs/stream` is already written with
`proxy_buffering off` — the backend design calls that "the one everyone forgets", so it was written
before the route existed rather than after the first silent bug.

Then retire `deploy/deploy-mock.sh` and `mock/`, and pick up `IKN-4` for the real deploy scripts:
rsync to a timestamped release directory, atomic switch, automatic rollback, deploy changelog — the
shape pfa, zeus and trekker already share.

## nginx access logs (IKN-16)

Three things on the box, none of them in this repository, and all three failing **silently** when
missed: the reporter swallows its own failures by design, and a tailer whose file does not exist
simply has nothing to say.

### 1. nginx says which site each line is for (IKN-84)

A site reaches Iknos by one of two doors.

**The shared log, the default.** Every vhost without an `access_log` of its own writes to
`/var/log/nginx/access.log` in the global `main` format. That format ends on `"$host"`, so each
line names its site. In `/etc/nginx/nginx.conf`, inside `http`:

```
log_format  main  '$remote_addr - $remote_user [$time_local] "$request" '
                  '$status $body_bytes_sent "$http_referer" '
                  '"$http_user_agent" "$http_x_forwarded_for" "$host"';
```

Only the last field is new. The start of the line is still `combined`, so nothing that already read
the file has to change. Iknos files each line under the service whose `hosts` lists that domain
(space-separated, as in `server_name`) and drops lines no row claims. **A new site is one
`hosts` value on its row** — nothing in its own repository, nothing in its vhost. The collector
reads the file from `IKNOS_NGINX_SHARED_LOG`, which defaults to that path.

**A file of its own.** A vhost that declares `access_log` (bots, fiducia, folio, iknos, zeus)
writes there and never to the shared file, so nothing is counted twice. Its row names the file in
`logGlob`, character for character.

Either way, check and reload:

```bash
ssh debian@ks-b 'sudo nginx -t && sudo systemctl reload nginx'
```

`nginx.conf` is not in this repository. If the box is rebuilt, the `"$host"` field is the one line to
put back.

### 2. The API's user reads it through the `adm` group

Files under `/var/log/nginx/` belong to `root:adm`. The pm2 user needs to be in `adm` — a
read-only grant on log files, not a sudo rule and not a root process. Zeus needed the same and
documents it; if it was done for Zeus it is already done for Iknos, since both run as the same
user.

Check rather than assume:

```bash
ssh debian@ks-b 'sudo -u debian head -c 200 /var/log/nginx/1991computer.access.log && echo "  ← readable"'
```

If it is not, `sudo usermod -aG adm debian` and then **restart** the API — group membership is
read at process start, so a reload is not enough.

### 3. The origin is allowed to post browser errors

`IKNOS_INGEST_ORIGINS` in `nest-api/ecosystem.config.js` gains the site, comma-separated, each
entry a bare scheme and host with no trailing slash:

```js
IKNOS_INGEST_ORIGINS: "https://1991computer.com",
```

Environment changes need `--update-env`; a plain reload keeps the old environment:

```bash
ssh debian@ks-b 'cd /var/www/iknos && pm2 reload ecosystem.config.js --update-env'
```

### Order matters

For a `logGlob` row: seed it **after** the vhost is writing its file. Seeded first, the collector
spends the gap stat-ing a path that does not exist — the same ordering trap `seed.ts` already warns
about for worldweathr's two rows. A `hosts` row has no such order: a domain that sends no lines yet
simply has none.

The seed's upsert leaves existing rows alone, so on ks-b a new `hosts` or `logGlob` value is an
`UPDATE service SET …` by hand, as worldweathr's health URL was.

### What this can and cannot see

- **The live file only.** logrotate's gzipped generations are out of scope: a tailer follows
  forward, and history from before it started is not its subject.
- **Access logs, not error logs.** `error_log` on ks-b is global rather than per-vhost, so
  per-site attribution would need a second and less pleasant prerequisite. A follow-up under
  IKN-28.
- **No `duration_ms`.** `combined` has no `$request_time`, so that column stays null for these
  rows and the Signals p95 is unaffected by them.
- **The same 14-day window as everything else.** `log_entry` is day-partitioned and dropped
  wholesale by `IKNOS_RETENTION_DAYS`; these rows cannot have a shorter one without a separate
  table.

## OTLP traces from the Officina apps (IKN-87)

`POST /api/otlp/v1/traces` takes OTLP/HTTP JSON traces from Opifex, Vidar, Auscult, Groma and
Auspex. Nothing changes in nginx: `location /api/` already proxies the route, and its default
`client_max_body_size` of 1 MB is the same ceiling the API enforces. The steps below are one-time.

### 1. Deploy — the migration runs by itself

`./nest-api/deploy-api.sh` applies `20261112120000_otlp_traces` between the build and the reload,
like every migration. It is purely additive: two new tables, `ingest_token` and `span`, nothing
existing altered. `span` is created with only `p_future`; the partition pass at boot carves the
daily window out of it, so check the boot line once:

```bash
ssh debian@ks-b 'pm2 logs iknos-api --lines 200 --nostream | grep "partition maintenance" | tail -1'
```

It should list `span` among the tables with partitions created.

Two optional variables, shown at their defaults, may go in `env_production` (with
`pm2 reload ecosystem.config.js --update-env`):

```js
IKNOS_OTLP_TOKEN_RATE_PER_MINUTE: 120, // per write token
IKNOS_OTLP_IP_RATE_PER_MINUTE: 240,    // per client address, whatever token it presents
```

### 2. One token per app, with its origin

On ks-b, from the API's directory — the script finds the production `DATABASE_URL` in the
ecosystem file the way `seed:user` does:

```bash
ssh debian@ks-b
cd /var/www/iknos/nest-api
pnpm token:create opifex-front  --origin https://opifex.1991computer.com  --label "opifex prod"
pnpm token:create vidar-front   --origin https://vidar.1991computer.com   --label "vidar prod"
pnpm token:create auscult-front --origin https://auscult.1991computer.com --label "auscult prod"
pnpm token:create groma-front   --origin https://groma.1991computer.com   --label "groma prod"
pnpm token:create auspex-front  --origin https://auspex.1991computer.com  --label "auspex prod"
```

Each prints its token **once**; only the SHA-256 is stored, so write it right away where the app's
pm2 file reads it: `/var/www/<app>/telemetry-token` on ks-b, alone, `chmod 600` (the Officina
monorepo's DEPLOY.md, "AI telemetry"). Only apps whose level is not `off` need one. A lost token is replaced, not recovered. The service must already be a
row in `service` (all five are, from `prisma/seed.ts`). An origin is the bare scheme and host,
exactly as a browser sends it — no path, no trailing slash; the script refuses anything else.
Add a second `--origin` for a staging host or `http://localhost:<port>` if the same token should
work there.

A token writes spans for its one service and nothing else: it is not a session, opens no read
route, and the payload's `service.name` is ignored.

### 3. Check one, end to end

```bash
TOKEN=ikt_...   # the one just printed
NOW=$(date +%s)000000000
curl -sS https://iknos.1991computer.com/api/otlp/v1/traces \
  -H 'Content-Type: application/json' -H "X-Iknos-Token: $TOKEN" \
  -d '{"resourceSpans":[{"scopeSpans":[{"spans":[{"traceId":"'$(openssl rand -hex 16)'","spanId":"'$(openssl rand -hex 8)'","name":"deploy.check","startTimeUnixNano":"'$NOW'","endTimeUnixNano":"'$NOW'"}]}]}]}'
# → {"partialSuccess":{}}
```

The run then shows under **traces** with that service selected in the rail.

### Listing and revoking

```bash
pnpm token:list          # id, service, active or revoked, last used, label, origins — never the token
pnpm token:revoke <id>
```

A revoked token's POSTs stop at once; preflights from its origin may still be answered for up to
30 seconds, which lets nothing through.
