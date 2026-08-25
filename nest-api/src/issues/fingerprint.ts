import { createHash } from "node:crypto";

/**
 * The identity of a grouped error (IKN-9): sixteen hex characters over a service, an error type
 * and a normalised stack, stored in `issue.fingerprint`.
 *
 * **Changing anything in this file is a data migration.** Every row already written carries the
 * old hashes, and a fingerprint that shifts splits one issue into two with the counter divided
 * between them — which is the exact failure the table exists to prevent. The tests pin outputs
 * for that reason, the way `labelsHash`'s do.
 *
 * The hash is sha256 truncated to sixteen hex characters, not the sha1 IKN-9's prose names. The
 * ticket is describing a shape — hash the service, the type and the top frames — and the repo
 * already has exactly one answer for "a stable, indexable, fixed-width identity column", in
 * `src/scrape/labels-hash.ts`. Two hash functions doing one job is a question every later reader
 * has to answer again.
 */

/**
 * How many frames of the stack decide identity.
 *
 * Deeper is more specific: it separates two errors that share their top frames but diverge below,
 * at the cost of splitting one error whose lower frames vary by call path. Five is the middle
 * this project starts at, and it is a constant rather than a literal so the day it moves is a day
 * somebody has to read this paragraph and the migration note above it.
 */
export const FRAME_DEPTH = 5;

/**
 * Deploy roots to reduce away, longest-first so `nest-api-releases/x` is matched before the
 * `nest-api` that is its prefix.
 *
 * Fleet layout, read off ks-b and recorded in DEPLOY.md: `/var/www/<app>/` holds `nest-api/`
 * (live), `nest-api-releases/<release>/` (staged, before the swap), `nest-api.bak/` (the previous
 * release, kept for rollback) and the same three for `public_html`.
 *
 * **IKN-9's stated reason for this is not the real one.** The ticket says a raw stack changes on
 * every deployment because releases run from `nest-api-releases/<hash>/`. They do not:
 * `deploy-api.sh:572` *moves* the staged release onto `nest-api/`, so the running process's paths
 * are stable across deploys and always have been. The normalisation earns its place anyway, for
 * three reasons the ticket did not give — a stack captured from a rolled-back `.bak` process, or
 * from a release directory during the window before the swap, must group with the same error seen
 * from the live path; a developer's own stack under `~/dev/iknos` must group with the server's;
 * and `culprit` is printed on the panel, where `/var/www/pfa/nest-api/dist/queue/export.js` is a
 * column of noise around the four segments that identify the file.
 */
const DEPLOY_ROOTS = [
  /^\/var\/www\/[^/]+\/[^/]+-releases\/[^/]+\//,
  /^\/var\/www\/[^/]+\/[^/]+\.bak\//,
  /^\/var\/www\/[^/]+\/[^/]+\//,
];

/** A V8 frame's location: `at fn (/path/file.js:12:34)`, or the bare `at /path/file.js:12:34`. */
const FRAME = /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/;

/**
 * Absolute path → the shortest form that still identifies the file.
 *
 * A path under a deploy root loses the root. A path under `node_modules` is cut at the last
 * `node_modules/`, so the same dependency resolved at two depths — hoisted here, nested there,
 * which pnpm does routinely — reads as one location.
 */
export function normalisePath(path: string): string {
  // ESM stacks carry `file:///var/www/…`; CJS ones carry the bare path. The same file must not
  // fingerprint differently because the app that threw was loaded as a module.
  const bare = path.startsWith("file://") ? path.slice("file://".length) : path;

  const nodeModules = bare.lastIndexOf("node_modules/");
  if (nodeModules !== -1) return bare.slice(nodeModules);

  for (const root of DEPLOY_ROOTS) {
    if (root.test(bare)) return bare.replace(root, "");
  }
  return bare;
}

/**
 * A stack trace → the frames that decide identity, top first, at most `FRAME_DEPTH` of them.
 *
 * Two rules, and the asymmetry between them is the point:
 *
 * - **A `node_modules` frame keeps no line at all.** A dependency bump moves every line in a file
 *   whose behaviour did not change, and an issue that re-opens itself on every `pnpm update` is
 *   an issue nobody reads twice.
 * - **Our own frames keep their line and lose their column.** The line is where the bug is; the
 *   column is where the formatter last left it, and a Biome release should not be able to split
 *   a six-month-old issue in two.
 *
 * The first line of a stack is the `Error: message` header, which carries the message rather than
 * a location and is dropped — the message is hashed separately, and only when there are no frames
 * at all.
 */
export function normaliseFrames(stack: string | null | undefined, depth = FRAME_DEPTH): string[] {
  if (!stack) return [];

  const frames: string[] = [];
  for (const line of stack.split("\n")) {
    const match = FRAME.exec(line);
    if (match === null) continue;

    const [, fn, rawPath, lineNo] = match;
    const path = normalisePath(rawPath);
    // `fn` is absent on a bare `at /path:1:2` frame, and is a real part of the identity when it is
    // there: two throws from the same file at the same line, in different functions, are two bugs.
    const where = path.startsWith("node_modules/") ? path : `${path}:${lineNo}`;
    frames.push(fn ? `${fn} (${where})` : where);

    if (frames.length === depth) break;
  }
  return frames;
}

/** UUIDs first: they are also long hex runs, and the more specific pattern has to win. */
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
/** Then bare hex identifiers — trace ids, sha prefixes, object ids. Eight is short enough to
 *  catch a truncated hash and long enough not to eat an English word: `deadbeef` is a casualty
 *  this accepts, `decade` is not. */
const HEX = /\b[0-9a-f]{8,}\b/gi;
/** Then anything numeric, including decimals and negatives. */
const NUMBER = /-?\d+(?:\.\d+)?/g;

/**
 * A message → the shape of the message, with everything that varies per occurrence blanked.
 *
 * This is only ever the fallback identity, for an error that arrived with no stack. Grouping on a
 * raw message would make `pool timeout after 8000ms` and `pool timeout after 8001ms` two issues
 * that no reader would ever call different.
 */
export function normaliseMessage(message: string): string {
  return message.replace(UUID, "<uuid>").replace(HEX, "<hex>").replace(NUMBER, "<n>").trim();
}

/**
 * The first frame that is ours — what the panel prints under the error type, and what
 * `issue.culprit` stores.
 *
 * A stack whose every frame is in `node_modules` has no culprit rather than a misleading one: the
 * top frame of a dependency's own throw says which library failed, which the error type already
 * said, and not one thing about where to look.
 */
export function culpritOf(frames: string[]): string | null {
  for (const frame of frames) {
    if (!frame.includes("node_modules/")) return frame;
  }
  return null;
}

export type FingerprintInput = {
  service: string;
  type: string | null;
  stack: string | null;
  message: string;
};

/**
 * The fingerprint, and the one function whose output reaches the database.
 *
 * **The service is inside the hash**, not beside it. That is what lets `issue.fingerprint` carry
 * a single `@unique` and the grouper be one upsert rather than a read-then-write that two
 * concurrent batches can both win — the argument `app_user.singleton` records in the schema,
 * applied to a second invariant.
 *
 * **The two modes are separated by a marker.** A stack-based hash and a message-based fallback
 * are computed over different things, and without `s`/`m` in the input an error whose message
 * happened to read like a frame list could collide with a real stack. The marker costs one byte
 * and removes the question.
 */
export function fingerprintOf(input: FingerprintInput): string {
  const frames = normaliseFrames(input.stack);
  const parts =
    frames.length > 0
      ? ["s", input.service, input.type ?? "", ...frames]
      : ["m", input.service, input.type ?? "", normaliseMessage(input.message)];

  // `\0` cannot occur in any part, so the join is unambiguous — concatenating with a printable
  // separator would let a message containing that separator impersonate a frame boundary.
  return createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 16);
}
