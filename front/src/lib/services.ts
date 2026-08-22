import "server-only";
import { apiOrigin } from "@lib/apiOrigin";
import { ROUTES } from "@lib/routes";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

/**
 * The service registry, read on the server — the rail's only data source in M1.
 *
 * Same loopback origin and the same fail-safe shape as `readBootstrap`, with one difference that
 * matters: `/api/services` sits behind the session guard (IKN-19), so the caller's cookie has to
 * be forwarded by hand. A server component has no browser attached to it, and without this the
 * API answers 401 and the rail renders empty for a signed-in user.
 */

/** Restated from `nest-api/src/contracts/service.ts`, which is the authoritative copy. */
export type ServiceHealth = {
  status: "ok" | "error" | "stale";
  httpStatus: number | null;
  latencyMs: number | null;
  checkedAt: string;
  checks: Record<string, { status: string; latencyMs: number }> | null;
};

export type Service = {
  name: string;
  pm2Name: string;
  enabled: boolean;
  /** Null for a service never probed — the rail draws no dot rather than a reassuring one (IKN-8). */
  health: ServiceHealth | null;
  /** Log lines per minute, last hour, oldest first. Sixty zeros is a true fact about an idle service. */
  sparkline: number[];
};

/**
 * Fails to an **empty list**, never to invented rows — and to `null` on a 401, which is a different
 * thing entirely.
 *
 * An unreachable API means "I do not know what is running", and a rail that answers that question
 * with a plausible-looking list of services is worse than one that answers it with nothing. The
 * empty state says so in words.
 *
 * A 401 means the API knows perfectly well and will not tell *this* caller, which is a session that
 * has ended. Folded into the empty list it would render a chassis with an empty rail over a log
 * panel about to 401 on its own — the screen IKN-44 is about.
 */
const fetchServices = async (): Promise<Service[] | null> => {
  try {
    const jar = await cookies();
    const cookie = jar.toString();

    const response = await fetch(`${apiOrigin()}/api/services`, {
      headers: cookie ? { cookie } : {},
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (response.status === 401) return null;
    if (!response.ok) return [];

    const body = (await response.json()) as { services?: unknown };
    if (!Array.isArray(body.services)) return [];

    // Normalised rather than trusted: against an API one deploy older than this front, a row
    // without the IKN-8 fields still renders — dotless and flat, never crashed.
    return body.services.flatMap((s): Service[] => {
      if (typeof s !== "object" || s === null || typeof (s as { name?: unknown }).name !== "string") return [];
      const row = s as { name: string } & Partial<Service>;
      return [
        {
          name: row.name,
          pm2Name: typeof row.pm2Name === "string" ? row.pm2Name : row.name,
          enabled: row.enabled !== false,
          health: typeof row.health === "object" ? (row.health ?? null) : null,
          sparkline: Array.isArray(row.sparkline)
            ? row.sparkline.filter((n): n is number => typeof n === "number")
            : [],
        },
      ];
    });
  } catch {
    return [];
  }
};

/**
 * The registry — and the one real session check a page load gets (IKN-44).
 *
 * `proxy.ts` can only see that a cookie *exists*: it runs on the Edge, where the Redis client does
 * not work. This is the first thing on the path that has asked the API whether that cookie still
 * means anything, so it is where a session that expired overnight — or was cleared by signing in
 * somewhere else — turns into the login screen rather than into an empty chassis.
 *
 * The redirect lives out here rather than inside `fetchServices` because `redirect` works by
 * throwing, and that function's own `catch` — the one that turns an unreachable API into an empty
 * rail — would swallow it and hand back `[]`.
 */
export const readServices = async (): Promise<Service[]> => {
  const services = await fetchServices();
  if (services === null) redirect(`${ROUTES.login}?expired=1`);
  return services;
};
