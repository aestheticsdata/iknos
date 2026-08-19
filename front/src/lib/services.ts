import "server-only";
import { apiOrigin } from "@lib/apiOrigin";
import { cookies } from "next/headers";

/**
 * The service registry, read on the server — the rail's only data source in M1.
 *
 * Same loopback origin and the same fail-safe shape as `readBootstrap`, with one difference that
 * matters: `/api/services` sits behind the session guard (IKN-19), so the caller's cookie has to
 * be forwarded by hand. A server component has no browser attached to it, and without this the
 * API answers 401 and the rail renders empty for a signed-in user.
 */

/** Restated from `nest-api/src/contracts/service.ts`, which is the authoritative copy. */
export type Service = {
  name: string;
  pm2Name: string;
  enabled: boolean;
};

/**
 * Fails to an **empty list**, never to invented rows.
 *
 * An unreachable API means "I do not know what is running", and a rail that answers that question
 * with a plausible-looking list of services is worse than one that answers it with nothing. The
 * empty state says so in words.
 */
export const readServices = async (): Promise<Service[]> => {
  try {
    const jar = await cookies();
    const cookie = jar.toString();

    const response = await fetch(`${apiOrigin()}/api/services`, {
      headers: cookie ? { cookie } : {},
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return [];

    const body = (await response.json()) as { services?: unknown };
    if (!Array.isArray(body.services)) return [];

    // The health state and the sparkline join this payload with IKN-8; nothing here invents them.
    return body.services.filter(
      (s): s is Service => typeof s === "object" && s !== null && typeof (s as Service).name === "string",
    );
  } catch {
    return [];
  }
};
