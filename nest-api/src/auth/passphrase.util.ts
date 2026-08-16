import { hashPassword, verifyPassword } from "./password.util";

/**
 * The recovery passphrase.
 *
 * ks-b has no mail server and is not getting one, so there is no reset link to send. A phrase
 * chosen at registration is the entire way back into the account — which is why the signup form
 * asks for it twice and says so plainly.
 */

export const MIN_PASSWORD = 12;

/** Longer than the password, because a phrase is easier to type than to guess. */
export const MIN_PASSPHRASE = 20;

/** A real hash of "no passphrase set", generated once with `hashPassword`. */
export const DUMMY_PASSPHRASE_HASH =
  "scrypt$131072$8$1$8/izLOwWoteIerRXWqLEOA==$JQNtaxzpM2Inv+djF1+WKinQ+shPnvjGirdFJ10sIzc=";

/**
 * The passphrase is a password by another name — same KDF, same parameters, one place to raise
 * the cost. It is not a second scheme just because it protects a second thing.
 */
export function hashPassphrase(passphrase: string): Promise<string> {
  return hashPassword(passphrase);
}

/**
 * Always runs a derivation, including against the dummy hash, so an account with no passphrase
 * costs exactly what a wrong one costs.
 *
 * `hash` is nullable because an account created by the CLI before the column existed has none.
 * Returning early on that would make "this account cannot be recovered" measurable with a
 * stopwatch — a list an attacker would very much like to have.
 */
export async function verifyPassphrase(hash: string | null, provided: string): Promise<boolean> {
  const matched = await verifyPassword(provided, hash ?? DUMMY_PASSPHRASE_HASH);
  return hash !== null && matched;
}

/**
 * Names the offending field and never echoes the value.
 *
 * A 400 that quotes the rejected password writes it into the access log of every proxy between
 * the browser and this process.
 */
export function assertLength(value: string | undefined, min: number, field: string): void {
  if (!value || value.length < min) {
    throw new Error(`${field} must be at least ${min} characters`);
  }
}
