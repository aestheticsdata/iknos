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

### 1. The site's vhost writes its own access log

In `/etc/nginx/sites-available/1991computer`, inside the `server` block:

```
access_log /var/log/nginx/1991computer.access.log combined;
```

Without it the site's requests go to the shared `/var/log/nginx/access.log` along with everything
else, and `combined` carries **no `$host` field** — so there is no way to tell which lines are the
landing page's. Iknos' own vhost already has the equivalent at `deploy/nginx/iknos.conf`.

The path must match the `logGlob` value on that service's row in `nest-api/prisma/seed.ts`,
character for character. Then:

```bash
ssh debian@ks-b 'sudo nginx -t && sudo systemctl reload nginx'
```

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

Seed the registry row **after** the vhost is writing its file. Seeded first, the collector spends
the gap stat-ing a path that does not exist — the same ordering trap `seed.ts` already warns about
for worldweathr's two rows.

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
