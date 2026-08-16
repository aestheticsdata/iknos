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
| front | `3006` | `iknos-web` | reserved, nothing listening |
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

`location /` in the vhost currently serves static files. When `iknos-web` starts listening on 3006,
the switch is two marked edits in that file: delete the block between the `MOCK PHASE` banners, and
uncomment the proxy blocks below it. The SSE block for `/api/logs/stream` is already written with
`proxy_buffering off` — the backend design calls that "the one everyone forgets", so it was written
before the route existed rather than after the first silent bug.

Then retire `deploy/deploy-mock.sh` and `mock/`, and pick up `IKN-4` for the real deploy scripts:
rsync to a timestamped release directory, atomic switch, automatic rollback, deploy changelog — the
shape pfa, zeus and trekker already share.
