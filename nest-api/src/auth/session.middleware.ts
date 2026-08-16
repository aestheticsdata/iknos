import { randomBytes } from "node:crypto";
import { RedisStore } from "connect-redis";
import session from "express-session";
import { SESSION_PREFIX } from "../redis/redis.service";
import { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from "./session.constants";

import type { RequestHandler } from "express";
import type { RedisClientType } from "redis";

const SESSION_ID_BYTES = 32;

/**
 * The session middleware, built as a function rather than inlined in `main.ts` so the tests
 * exercise the configuration that actually ships. A store configured one way in production and
 * another way under test proves nothing about either.
 *
 * `secure` is a parameter and not a `NODE_ENV` read: this file has no business knowing which
 * environment it is in, and a boolean is something a test can set both ways.
 */
export function buildSessionMiddleware(client: RedisClientType, secret: string, secure: boolean): RequestHandler {
  return session({
    name: SESSION_COOKIE_NAME,
    store: new RedisStore({ client, prefix: SESSION_PREFIX, ttl: SESSION_TTL_SECONDS }),
    // Signed with IKNOS_COOKIE_SECRET. The id is opaque either way; the signature is what stops
    // a forged cookie from reaching a Redis lookup at all.
    secret,
    // 32 random bytes rather than express-session's default 24, base64url so it survives a
    // cookie unescaped.
    genid: () => randomBytes(SESSION_ID_BYTES).toString("base64url"),
    resave: false,
    // No Redis entry and no Set-Cookie until there is something to remember, so an
    // unauthenticated probe of /health cannot fill the keyspace shared with the other apps.
    saveUninitialized: false,
    // Slides the TTL: express-session calls the store's `touch` on every request, which is an
    // EXPIRE on the key.
    rolling: true,
    // Behind nginx. Without this pair — and `trust proxy` on the express instance — express
    // sees a plain-HTTP loopback request and refuses to set a Secure cookie.
    proxy: true,
    cookie: {
      httpOnly: true,
      secure,
      // Lax and not Strict: this is what protects the login POST, which by definition has no
      // CSRF token to present yet, while still letting a link from elsewhere land logged in.
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_SECONDS * 1000,
    },
  });
}
