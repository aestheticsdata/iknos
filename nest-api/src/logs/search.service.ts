import { PrismaService } from "@db/prisma.service";
import { Injectable } from "@nestjs/common";
import { escapeLike } from "./log-query";

import type { SearchHit } from "@contracts/search";

/**
 * The ⌘K palette's data half (IKN-22).
 *
 * Four sources, queried in parallel and capped independently. Independent caps are the point: a
 * host with four hundred routes and one service would otherwise fill all five slots with routes,
 * and the service the reader was actually reaching for would not be in the list at all.
 */

/** Five per type — enough to recognise the one you meant, short enough to read without scrolling. */
export const PER_TYPE_LIMIT = 5;

/**
 * Below this the palette does not query at all.
 *
 * A single character matches most of the table and answers with five arbitrary rows, which is
 * noise dressed as a result. It also spares the database a `GROUP BY` on every first keystroke of
 * every search.
 */
export const MIN_QUERY_LENGTH = 2;

type ServiceRow = { name: string };
type IssueRow = { fingerprint: string; type: string | null; message: string; event_count: number };
type RouteRow = { route: string; hits: bigint | number };
type TraceRow = { trace_id: string; hits: bigint | number };

const lines = (n: bigint | number): string => {
  const count = Number(n);
  return `${count} line${count === 1 ? "" : "s"}`;
};

const occurrences = (n: bigint | number): string => {
  const count = Number(n);
  return `${count} occurrence${count === 1 ? "" : "s"}`;
};

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(term: string, from: Date, to: Date): Promise<SearchHit[]> {
    if (term.length < MIN_QUERY_LENGTH) return [];

    // Escaped, never stripped: someone pasting `/api/items/100%` is searching for a literal path,
    // and an unescaped `%` there matches every route beginning `/api/items/100`.
    //
    // No `ESCAPE` clause anywhere below, for the reason `whereClause` already records: backslash
    // is MySQL's default escape character for `LIKE`, and spelling it out means writing a
    // backslash that has to survive both JavaScript and SQL string parsing — which it does not.
    const like = escapeLike(term);

    // In parallel, because they are four independent queries against four different indexes and
    // the palette's whole budget is one keystroke's worth of latency.
    const [services, issues, routes, traces] = await Promise.all([
      this.services(like),
      this.issues(like),
      this.routes(like, from, to),
      this.traces(like, from, to),
    ]);

    return [...services, ...issues, ...routes, ...traces];
  }

  /**
   * The registry, and **not** the distinct services in `log_entry`.
   *
   * The rail is built from the registry, so the palette has to offer the same list — a service
   * that has been quiet all week is still one you can scope to, and one that logged something once
   * under a name nobody registered is not.
   *
   * Unbounded by time for the same reason: this table has as many rows as the host has processes.
   */
  private async services(like: string): Promise<SearchHit[]> {
    const rows = await this.prisma.$queryRaw<ServiceRow[]>`
      SELECT name FROM service
       WHERE enabled = TRUE AND name LIKE ${`%${like}%`}
       ORDER BY name ASC
       LIMIT ${PER_TYPE_LIMIT}`;

    return rows.map((row) => ({ type: "service" as const, label: row.name, value: row.name, hint: null }));
  }

  /**
   * Grouped errors, by fingerprint, type or message (IKN-9, IKN-14).
   *
   * **Unbounded by time, beside `services()` rather than with the windowed pair.** `issue` is
   * unpartitioned and holds one row per distinct error, so there are no partitions to prune — and
   * an issue whose whole value is that it is three weeks old and still unresolved is precisely
   * the one a windowed search would fail to find.
   *
   * Three columns matched, because there are three ways a reader arrives at an issue: pasting the
   * fingerprint off a row, typing the error's type, or half-remembering its message. The
   * fingerprint is matched by **prefix**, like a trace id and for the same reason — it is a hash,
   * so a substring of one is a coincidence rather than an intent.
   *
   * Most recent first: two issues matching `TypeError` are told apart by which one is still
   * happening.
   */
  private async issues(like: string): Promise<SearchHit[]> {
    const rows = await this.prisma.$queryRaw<IssueRow[]>`
      SELECT fingerprint, type, message, event_count
        FROM issue
       WHERE fingerprint LIKE ${`${like}%`}
          OR type LIKE ${`%${like}%`}
          OR message LIKE ${`%${like}%`}
       ORDER BY last_seen DESC
       LIMIT ${PER_TYPE_LIMIT}`;

    return rows.map((row) => ({
      type: "issue" as const,
      // The type is what a reader recognises an issue by; the message is the fallback for an
      // exception that carried no type, cut to a line so one runaway string cannot own the list.
      label: row.type ?? row.message.split("\n")[0].slice(0, 80),
      // The action operates on the fingerprint — it is what the routes and the URL are keyed on.
      value: row.fingerprint,
      hint: occurrences(row.event_count),
    }));
  }

  /**
   * Routes seen in the window, busiest first.
   *
   * Bounded by the window for the same reason `GET /api/logs` insists on one: this groups over
   * `log_entry`, and without a range predicate MySQL cannot discard a single partition. Busiest
   * first rather than alphabetical because the route worth jumping to is almost always the one
   * generating the traffic.
   */
  private async routes(like: string, from: Date, to: Date): Promise<SearchHit[]> {
    const rows = await this.prisma.$queryRaw<RouteRow[]>`
      SELECT route, COUNT(*) AS hits
        FROM log_entry
       WHERE ts >= ${from} AND ts < ${to}
         AND route IS NOT NULL AND route LIKE ${`%${like}%`}
       GROUP BY route
       ORDER BY hits DESC
       LIMIT ${PER_TYPE_LIMIT}`;

    return rows.map((row) => ({
      type: "route" as const,
      label: row.route,
      value: row.route,
      hint: lines(row.hits),
    }));
  }

  /**
   * Trace ids by **prefix**, not substring — the one place here that is deliberately narrower.
   *
   * `LIKE '%abc%'` on `trace_id` cannot use the `(trace_id, ts)` index and degrades into a scan of
   * every row in the window; `LIKE 'abc%'` walks the index. It also matches how a trace id is
   * actually searched for: pasted whole, or typed from the front, because the leading characters
   * are the ones on screen in the table's TRACE column.
   */
  private async traces(like: string, from: Date, to: Date): Promise<SearchHit[]> {
    const rows = await this.prisma.$queryRaw<TraceRow[]>`
      SELECT trace_id, COUNT(*) AS hits
        FROM log_entry
       WHERE ts >= ${from} AND ts < ${to}
         AND trace_id IS NOT NULL AND trace_id LIKE ${`${like}%`}
       GROUP BY trace_id
       ORDER BY hits DESC
       LIMIT ${PER_TYPE_LIMIT}`;

    return rows.map((row) => ({
      type: "trace" as const,
      label: row.trace_id,
      value: row.trace_id,
      hint: lines(row.hits),
    }));
  }
}
