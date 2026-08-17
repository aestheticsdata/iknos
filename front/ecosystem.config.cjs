/**
 * PM2 config for the Iknos front.
 *
 * Port 3006, reserved in Zeus's registry alongside the API's 6900 (2026-08-04: 3000 pfa, 3001
 * hiwaysim, 3002 worldweathr, 3003 zeus, 3100 bkmk). Bound to 127.0.0.1 — nginx is the only way in.
 *
 * `iknos-web` is the pm2 name that registry row expects, and the name the service rail will show
 * once it reads PM2 rather than the mockup's invented `iknos-ui`. Renaming it here breaks both.
 *
 * Unlike the API's, this file holds no secrets and is committed: the front talks to the API over
 * localhost and has nothing to authenticate with. `IKNOS_API_ORIGIN` is where server components
 * read the registration seal from — the loopback address of the API, never the public hostname,
 * so the request never leaves the box or waits on nginx.
 */
module.exports = {
  apps: [
    {
      name: "iknos-web",
      cwd: __dirname,
      script: "./node_modules/next/dist/bin/next",
      args: "start -p 3006 -H 127.0.0.1",
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      env: {
        NODE_ENV: "production",
        PORT: "3006",
        HOST: "127.0.0.1",
        IKNOS_API_ORIGIN: "http://127.0.0.1:6900",
      },
    },
  ],
};
