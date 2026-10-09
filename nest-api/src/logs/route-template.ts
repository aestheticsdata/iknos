import { Prisma } from "@generated/prisma/client";
import { escapeLike } from "./log-query";

/**
 * A route filter that understands Express patterns (IKN-23).
 *
 * The metrics view names routes the way prom-client labels them — Express's matched pattern,
 * `/api/spendings/:id` — because a raw URL would mint one series per identifier. The log lines
 * name them the other way: PFA's logger writes `url.path`, the path that was actually asked for,
 * `/api/spendings/4182`. So "open the logs of this route" with an exact comparison would match
 * nothing for every route that has a parameter, which is every route worth investigating.
 *
 * A filter value with a `:name` segment is therefore read as a pattern: each such segment matches
 * exactly one path segment, and everything else matches itself. A value without one is compared
 * exactly, as it always was — the token bar's existing route chips are untouched.
 *
 * Kept to `:name`. Express also accepts `:name?`, inline regexes and wildcards; prom-client's
 * label carries whatever the route was declared as, and PFA's middleware already files wildcard
 * matches under `unknown`. A pattern this does not understand degrades to an exact comparison,
 * which matches the lines that literally carry it — nothing, usually, and visibly so.
 */

const PARAM = /^:[A-Za-z_$][\w$]*$/;

/** Whether the value is a pattern at all — any segment of the form `:name`. */
export function isRouteTemplate(route: string): boolean {
  return route.split("/").some((segment) => PARAM.test(segment));
}

/** The pattern as an anchored regex source: a parameter is one non-empty segment. */
export function templateSource(route: string): string {
  const body = route
    .split("/")
    .map((segment) => (PARAM.test(segment) ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");

  return `^${body}$`;
}

/** The in-memory form, for the live tail — the same predicate the SQL applies. */
export function routeMatches(filter: string, route: string | null): boolean {
  if (route === null) return false;
  if (!isRouteTemplate(filter)) return route === filter;

  return new RegExp(templateSource(filter)).test(route);
}

/**
 * The SQL form.
 *
 * **The `LIKE` on the literal prefix is what keeps it fast.** `REGEXP` alone cannot use the
 * `(route, ts)` index and would be evaluated on every line of the window; the prefix up to the
 * first parameter is a range on that index, and the regex only has to settle the handful of lines
 * already inside it — `/api/spendings/4182/receipts` starts with the same prefix and is not the
 * same route.
 */
export function routeClause(filter: string): Prisma.Sql {
  if (!isRouteTemplate(filter)) return Prisma.sql`route = ${filter}`;

  const segments = filter.split("/");
  const firstParam = segments.findIndex((segment) => PARAM.test(segment));
  const prefix = `${segments.slice(0, firstParam).join("/")}/`;

  return Prisma.sql`(route LIKE ${`${escapeLike(prefix)}%`} AND route REGEXP ${templateSource(filter)})`;
}
