import "server-only";

/**
 * Where the server half of the front reaches the API.
 *
 * **Loopback, never the public hostname.** A server component asking nginx for `/api/services`
 * would leave the box, come back in through TLS and the rate limiter, and count against the
 * sign-in bucket of whatever IP the box presents as. It also could not work at all while nginx is
 * reloading, which is exactly when someone is most likely to be looking at the page.
 *
 * The default differs by environment because the two API instances do: ks-b's pm2 process listens
 * on 6900 (registered alongside the rest of the fleet), and a checkout on a laptop listens on
 * whatever `IKNOS_PORT` says, which is 4310. Hard-coding either one alone is wrong somewhere —
 * before this was shared, `services.ts` defaulted to 6900 while `next.config.js`'s dev rewrite
 * defaulted to 4310, so a signed-in developer got a rail with no services in it and the register
 * screen failed closed to the sealed banner on an instance that had no account.
 *
 * `IKNOS_API_ORIGIN` overrides both, which is what a non-default port on either machine needs.
 */
const DEV_ORIGIN = "http://127.0.0.1:4310";
const PROD_ORIGIN = "http://127.0.0.1:6900";

export const apiOrigin = (): string =>
  process.env.IKNOS_API_ORIGIN ?? (process.env.NODE_ENV === "development" ? DEV_ORIGIN : PROD_ORIGIN);
