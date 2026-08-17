import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison, for any secret a request presents and the server has to check.
 *
 * A plain `===` returns as soon as two bytes differ, so the time it takes leaks how much of the
 * value was right. Over enough attempts that is a value recovered one character at a time.
 *
 * Two callers so far: the CSRF token, and the ingestion token.
 */
export function timingSafeCompare(expected: string, provided: string): boolean {
  // Both guards matter, and the second especially: a server with no secret configured would
  // otherwise compare "" against "" and accept a request carrying nothing at all.
  if (!expected || !provided) return false;

  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  // `timingSafeEqual` throws on a length mismatch, so this has to come first. It leaks the
  // length, which is neither secret nor variable for the values compared here.
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}
