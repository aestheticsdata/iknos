import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import type { ScryptOptions } from "node:crypto";

/**
 * `scrypt` is overloaded, and `promisify` resolves to the three-argument form — the one without
 * options, which is exactly the argument we cannot do without. Typed explicitly rather than
 * inferred.
 */
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * Password hashing on `node:crypto`, with no dependency.
 *
 * scrypt rather than bcrypt — the fleet's other four APIs use `bcryptjs`, and this is a
 * deliberate departure. scrypt is memory-hard, bcrypt is not, and OWASP ranks them in that
 * order. `bcryptjs` is also a pure-JS reimplementation rather than a binding.
 *
 * Not argon2, which would rank higher still: `crypto.argon2` is experimental, and it only
 * exists from Node 24.11. ks-b was on v24.3.0 when this was written, where it is `undefined` —
 * the kind of thing that compiles on a laptop and throws on the box.
 */

/** OWASP's parameters. ~270ms on the dev machine, ~310ms on ks-b. */
const DEFAULTS = { N: 2 ** 17, r: 8, p: 1 } as const;
const KEY_BYTES = 32;
const SALT_BYTES = 16;

export type ScryptParams = { N: number; r: number; p: number };

/**
 * scrypt needs 128 * N * r bytes, ~134 MiB at the defaults, and its own ceiling defaults to
 * 32 MiB — below which it refuses the parameters outright rather than running slowly.
 */
function maxmemFor({ N, r }: ScryptParams): number {
  return Math.max(256 * 1024 * 1024, 128 * N * r * 2);
}

function derive(password: string, salt: Buffer, length: number, params: ScryptParams): Promise<Buffer> {
  return scryptAsync(password, salt, length, { ...params, maxmem: maxmemFor(params) }) as Promise<Buffer>;
}

/**
 * Returns `scrypt$N$r$p$salt$key`, salt and key base64.
 *
 * The parameters travel with the hash rather than being assumed, so raising the cost later is a
 * one-line change that leaves the existing account able to log in — which matters more here
 * than anywhere, since there is only ever one account and no administrator to reset it.
 */
export async function hashPassword(password: string, params: ScryptParams = DEFAULTS): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, KEY_BYTES, params);

  return ["scrypt", params.N, params.r, params.p, salt.toString("base64"), key.toString("base64")].join("$");
}

/**
 * Never throws. Anything unparseable is a failed login, not a 500: the column could hold a hash
 * from another era, and an exception there would report "server broken" for what is really
 * "these credentials do not work".
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, saltB64, keyB64] = parts;
  const params: ScryptParams = { N: Number(n), r: Number(r), p: Number(p) };
  if (!Object.values(params).every((value) => Number.isInteger(value) && value > 0)) return false;

  const key = Buffer.from(keyB64, "base64");
  if (key.length === 0) return false;

  // Parameters come from the stored hash, never from DEFAULTS: an account created before a cost
  // increase has to keep verifying against the cost it was created with.
  const derived = await derive(password, Buffer.from(saltB64, "base64"), key.length, params);

  return timingSafeEqual(key, derived);
}
