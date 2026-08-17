import { timingSafeCompare } from "../common/timing-safe";

/**
 * Constant-time comparison of a session's CSRF token against the one a request presented.
 *
 * Same shape as PFA's and trekker's `csrf-token.util.ts`. The cookie alone is not proof of
 * intent — the browser attaches it to any request, including one a third-party page triggered —
 * so an unsafe verb has to echo back a value only a same-origin script could have read.
 *
 * The comparison itself lives in `common/timing-safe.ts`, shared with the ingestion token.
 */
export function verifyCsrf(expected: string, provided: string): boolean {
  return timingSafeCompare(expected, provided);
}
