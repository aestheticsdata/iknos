/**
 * Refusing to shoot before there is anything to shoot.
 *
 * Without this the first thing that happens is `demo.setup.ts` reporting
 * `net::ERR_CONNECTION_REFUSED` with a stack pointing into a file about signing
 * in — which says nothing about the actual problem, and sends you looking at
 * credentials. The demo has three preconditions and none of them are the
 * script's to fix, so it names them instead.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3006";

/**
 * The API is probed on its own origin, not through the front.
 *
 * The browser only ever talks to `/api/…` on the front's origin: in production nginx routes it to
 * Nest, and on a laptop the `next.config.js` rewrite does — but only when `IKNOS_API_ORIGIN` was set
 * at `next build` (IKN-67). Probing Nest directly is the question that has one answer.
 * `/health` lives outside `/api` (`nest-api/src/health.controller.ts`).
 */
const API_URL = process.env.IKNOS_API_ORIGIN ?? "http://127.0.0.1:4310";

async function reachable(url: string): Promise<boolean> {
  try {
    // Any answer at all is enough — a 401 or a redirect still proves something
    // is listening, which is the whole question here.
    await fetch(url, { signal: AbortSignal.timeout(3000), redirect: "manual" });
    return true;
  } catch {
    return false;
  }
}

export default async function preflight(): Promise<void> {
  const problems: string[] = [];

  if (!(await reachable(`${BASE_URL}/login/`))) {
    problems.push(
      `Nothing is listening on ${BASE_URL}.\n` +
        "    The demo films the monitor; it does not start it. In two shells:\n" +
        "      cd nest-api && pnpm dev\n" +
        "      cd front && NEXT_PUBLIC_IKNOS_HOST_LABEL=web01 IKNOS_API_ORIGIN=http://127.0.0.1:4310 pnpm build && IKNOS_API_ORIGIN=http://127.0.0.1:4310 pnpm start\n" +
        "    Shoot against the built front, not `pnpm dev` — a dev build floats\n" +
        "    its own overlays over the app.",
    );
  } else if (!(await reachable(`${API_URL}/health`))) {
    problems.push(
      `${BASE_URL} answers, but the Nest API does not answer on ${API_URL}.\n` +
        "    Start it with `cd nest-api && pnpm dev` (it listens on 4310).",
    );
  }

  if (!process.env.DEMO_USERNAME || !process.env.DEMO_PASSWORD) {
    problems.push("DEMO_USERNAME and DEMO_PASSWORD are missing from front/.env.test.local.");
  }

  if (problems.length > 0) {
    throw new Error(`\n\n  The demo cannot record yet:\n\n  - ${problems.join("\n\n  - ")}\n`);
  }
}
