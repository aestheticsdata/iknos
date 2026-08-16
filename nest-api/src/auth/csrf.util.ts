import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison of a session's CSRF token against the one a request presented.
 *
 * Same shape as PFA's and trekker's `csrf-token.util.ts`. The cookie alone is not proof of
 * intent — the browser attaches it to any request, including one a third-party page triggered —
 * so an unsafe verb has to echo back a value only a same-origin script could have read.
 */
export function verifyCsrf(expected: string, provided: string): boolean {
  // Both guards matter, and the second one especially: a session that never got a token would
  // otherwise compare "" against "" and let a request carrying no token at all through.
  if (!expected || !provided) return false;

  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  // timingSafeEqual throws on a length mismatch, so this must come first. It leaks the length,
  // which is fixed and public — every token is 32 bytes in base64url.
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}
