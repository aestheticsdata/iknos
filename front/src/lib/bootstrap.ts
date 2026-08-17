import "server-only";

/**
 * Whether this instance already has its account.
 *
 * **Read on the server, deliberately.** Fetching it from the browser would mean rendering
 * *something* while the answer is in flight, and the only two candidates are a spinner or the
 * first-run form. The form is the dangerous one: for a few hundred milliseconds a real, submittable
 * "create the admin account" screen sits in front of someone on an instance that already has one.
 * The seal is a security property, so it is decided before a single byte of the page is sent.
 *
 * Same choice as Worldweathr's signup page, and the reason IKN-21 exposes `bootstrap` as a route of
 * its own rather than letting the register form infer the seal from a 409.
 */

/** The API over loopback. Never the public hostname: that would leave the box and wait on nginx. */
const API_ORIGIN = process.env.IKNOS_API_ORIGIN ?? "http://127.0.0.1:6900";

export type Bootstrap = { sealed: boolean };

/**
 * Fails **closed**. An API that is down, slow, or answering nonsense produces `sealed: true`, and
 * the register screen shows the sealed banner.
 *
 * The asymmetry is the point: a sealed banner on a genuinely open instance is a confusing minute
 * for the one person who owns the box. An open form on an instance whose API cannot be reached is
 * an open registration endpoint on the public internet, and the failure that produces it —
 * `iknos-api` being down — is the most likely failure there is.
 */
export const readBootstrap = async (): Promise<Bootstrap> => {
  try {
    const response = await fetch(`${API_ORIGIN}/api/auth/bootstrap`, {
      // The seal changes exactly once in the lifetime of an instance, but caching the *unsealed*
      // answer would keep the form alive after registration. Never cached.
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return { sealed: true };

    const body = (await response.json()) as Partial<Bootstrap>;
    return { sealed: body.sealed !== false };
  } catch {
    return { sealed: true };
  }
};
