import { Prisma } from "@generated/prisma/client";
import { LEVELS } from "@ingest/parser";
import { BadRequestException } from "@nestjs/common";
import { IsOptional, IsString } from "class-validator";
import { decodeCursor } from "./cursor";

/**
 * The filter vocabulary, parsed once and shared by every log route.
 *
 * Search, histogram, trace, the row detail and the live tail take the same parameters and must
 * interpret them identically — otherwise the histogram totals stop matching the search below it, and the live
 * tail shows lines the filter above it excludes. One parser, one `WHERE` builder, no copies.
 */

/**
 * Every field arrives as a string and is parsed here rather than by the pipe.
 *
 * The global `ValidationPipe` runs without `transform`, so a `@Type(() => Number)` on a query DTO
 * would be silently inert and `p.limit` would be the string `"50"` while typed `number`. Declaring
 * what actually arrives and converting explicitly is the version that cannot drift with the pipe's
 * configuration.
 */
export class LogQueryDto {
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsString() service?: string;
  /** A minimum: `?level=warn` (or `?level=40`) means warnings and everything worse. */
  @IsOptional() @IsString() level?: string;
  @IsOptional() @IsString() route?: string;
  @IsOptional() @IsString() status?: string;
  /** Substring of `message`. */
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @IsString() limit?: string;
  /** Which way a cursor (or `at`) walks. Anything but `"after"` means `"before"` — the existing,
      default direction — rather than a 400 for a stray value on an old link. */
  @IsOptional() @IsString() dir?: string;
  /** Seeds the first page at an arbitrary instant instead of at `to` — a "jump to time". Ignored
      once `cursor` is present, since a real cursor is a more precise continuation of a page
      already in hand. */
  @IsOptional() @IsString() at?: string;
}

export type LogFilters = {
  from: Date;
  to: Date;
  service?: string;
  minLevel?: number;
  route?: string;
  statusCode?: number;
  q?: string;
};

/**
 * Long enough for a stack frame or a URL with its query string, short enough that the `LIKE`
 * stays a scan of the already-reduced set rather than a pathological one.
 */
const MAX_Q_LENGTH = 200;

export const MAX_LIMIT = 200;
export const DEFAULT_LIMIT = 100;

function toInt(name: string, raw: string): number {
  // `Number` rather than `parseInt`: parseInt("40abc") is 40, and a filter that quietly ignores
  // the end of what it was given is worse than one that refuses it.
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new BadRequestException(`'${name}' must be an integer`);
  return n;
}

/** Accepts pino's numeric scale or any name the ingestion parser recognises. */
function toLevel(raw: string): number {
  const named = LEVELS[raw.toLowerCase()];
  if (named !== undefined) return named;

  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new BadRequestException(`'level' must be a number or one of: ${Object.keys(LEVELS).join(", ")}`);
  }
  return n;
}

/**
 * The rule the whole schema rests on: **a query without both bounds is a 400, never a widened
 * one.** `log_entry` is partitioned by day, and the range predicate is what lets MySQL discard
 * whole partitions before evaluating anything else. An unbounded query is a full scan of every
 * day ever retained, and it takes one forgotten parameter for the page to become unusable.
 */
export function parseWindow(p: { from?: string; to?: string }): { from: Date; to: Date } {
  if (!p.from || !p.to) throw new BadRequestException("both 'from' and 'to' are required");

  const from = new Date(p.from);
  const to = new Date(p.to);
  if (Number.isNaN(+from) || Number.isNaN(+to)) {
    throw new BadRequestException("'from' and 'to' must be ISO-8601 timestamps");
  }
  if (to <= from) throw new BadRequestException("'to' must be after 'from'");

  return { from, to };
}

export function parseFilters(p: LogQueryDto): LogFilters {
  const { from, to } = parseWindow(p);

  const q = p.q?.trim();
  if (q && q.length > MAX_Q_LENGTH) {
    throw new BadRequestException(`'q' must be at most ${MAX_Q_LENGTH} characters`);
  }

  // `|| undefined` throughout, never `?? undefined`: an empty parameter (`?service=&level=`) is a
  // filter the UI cleared, not a filter for the empty string — and `Number("")` is 0, so a bare
  // `?status=` would otherwise silently become `status_code = 0`.
  return {
    from,
    to,
    service: p.service || undefined,
    minLevel: p.level ? toLevel(p.level) : undefined,
    route: p.route || undefined,
    statusCode: p.status ? toInt("status", p.status) : undefined,
    q: q || undefined,
  };
}

/** The largest `UNSIGNED BIGINT` there is. Past it the driver has nothing to bind. */
const MAX_ROW_ID = 18_446_744_073_709_551_615n;

export type PageDirection = "before" | "after";

/** Anything but the one other value means the default — see `LogQueryDto.dir`. */
export function parseDir(raw: string | undefined): PageDirection {
  return raw === "after" ? "after" : "before";
}

/**
 * An instant to seed the first page at, or `null` if `at` was absent or would not parse.
 *
 * Same leniency as `decodeCursor`: this comes off a URL, and a value that will not parse means
 * "no seed", not a 400 — the query still has `from`/`to` to fall back on, exactly as if `at` had
 * never been sent.
 */
export function parseAt(raw: string | undefined): Date | null {
  if (!raw) return null;
  const at = new Date(raw);
  return Number.isNaN(+at) ? null : at;
}

/**
 * The effective keyset cursor for a request: a real `cursor` if one decoded, else `at` turned into
 * a synthetic one, else nothing (the original "start at `to`" page).
 *
 * `at` always becomes `(at, MAX_ROW_ID)`, in **both** directions — not `MIN_ROW_ID` for `"after"`,
 * which looks symmetric and is the wrong choice. A real row sharing `at`'s exact millisecond has
 * some ordinary id, always less than `MAX_ROW_ID`; pairing `at` with the max makes `"before"` (`<`)
 * include that row and `"after"` (`>`) exclude it, so the two directions partition the table
 * cleanly at `ts <= at` / `ts > at`. `MIN_ROW_ID` on the `"after"` side would instead make *both*
 * directions include that row — the front end's anchor page and its newer-chain's first page would
 * each hand back the same row, a real duplicate in whatever list merges the two.
 */
export function resolveCursor(p: { cursor?: string; at?: string }): { ts: Date; id: bigint } | undefined {
  if (p.cursor) return decodeCursor(p.cursor) ?? undefined;

  const at = parseAt(p.at);
  return at ? { ts: at, id: MAX_ROW_ID } : undefined;
}

/**
 * A row id off the URL, as the BIGINT it addresses.
 *
 * Digits only — `Number` is not an option here at all, since `log_entry.id` is an `UNSIGNED
 * BIGINT` and the whole reason it crosses the wire as a string is that past 2^53 a JSON number
 * rounds silently. A rounded id would not 404; it would answer with the wrong line, confidently.
 *
 * The ceiling is checked rather than left to the driver: an id nobody could have is a malformed
 * request, and a 400 says so where a bind error would surface as a 500 on a crafted URL.
 */
export function parseRowId(raw: string): bigint {
  if (!/^\d{1,20}$/.test(raw)) throw new BadRequestException("'id' must be a row id");

  const id = BigInt(raw);
  if (id > MAX_ROW_ID) throw new BadRequestException("'id' must be a row id");
  return id;
}

export function parseLimit(raw: string | undefined): number {
  if (!raw) return DEFAULT_LIMIT;
  // Clamped rather than refused: an oversized page is a caller being optimistic, not a caller
  // being wrong, and the ceiling is the server's to enforce either way.
  return Math.min(Math.max(toInt("limit", raw), 1), MAX_LIMIT);
}

/**
 * `%`, `_` and `\` are wildcards to `LIKE`, so someone searching for `100%` would otherwise match
 * every line starting with `100`. Escaped, not stripped: the point of dropping FULLTEXT was to be
 * able to search for literal text — paths, UUIDs, trace ids — so the search has to be literal.
 */
export function escapeLike(term: string): string {
  return term.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * The `WHERE` clause, identical for the search and the histogram.
 *
 * Shared rather than written twice, and that is a correctness property rather than tidiness: the
 * histogram's per-level counts are supposed to total exactly the search's row count over the same
 * filters, and the two queries must prune the same partitions. Two copies of this would agree
 * until the day one of them was edited.
 *
 * Every value is a bound parameter. Nothing here is ever interpolated into the SQL text.
 */
export function whereClause(
  f: LogFilters,
  cursor?: { ts: Date; id: bigint },
  dir: PageDirection = "before",
): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`ts >= ${f.from}`, Prisma.sql`ts < ${f.to}`];

  if (f.service !== undefined) parts.push(Prisma.sql`service = ${f.service}`);
  if (f.minLevel !== undefined) parts.push(Prisma.sql`level >= ${f.minLevel}`);
  if (f.route !== undefined) parts.push(Prisma.sql`route = ${f.route}`);
  if (f.statusCode !== undefined) parts.push(Prisma.sql`status_code = ${f.statusCode}`);
  // No `ESCAPE` clause: backslash is already MySQL's default escape character for `LIKE`, and
  // spelling it out in a template literal means writing a backslash that has to survive both
  // JavaScript and SQL string parsing — which it does not.
  if (f.q !== undefined) parts.push(Prisma.sql`message LIKE ${`%${escapeLike(f.q)}%`}`);

  if (cursor !== undefined) {
    // A row-value comparison rather than `ts < ? OR (ts = ? AND id < ?)`: rows sharing a
    // millisecond are common at this volume, and the two-clause form is where a keyset walk
    // starts repeating or skipping them. The operator is the only thing `dir` changes — `"after"`
    // walks the same comparison the other way, toward more recent rows.
    const op = dir === "before" ? Prisma.sql`<` : Prisma.sql`>`;
    parts.push(Prisma.sql`(ts, id) ${op} (${cursor.ts}, ${cursor.id})`);
  }

  return Prisma.join(parts, " AND ");
}
