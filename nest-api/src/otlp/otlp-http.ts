import { logger } from "@common/logger";
import { OTLP_BODY_LIMIT, OTLP_TRACES_PATH } from "./otlp-limits";

import type { IncomingMessage } from "node:http";
import type { NextFunction, Request, Response } from "express";
import type { OriginCheck } from "./interfaces/otlp-types";

/**
 * The two pieces of `POST /api/otlp/v1/traces` that have to run before Nest routes anything
 * (IKN-87): the body reader and CORS. Both are mounted by `main.ts` and by the e2e `buildTestApp`,
 * in the same order, and both are scoped to the one path.
 */

/** The route, with any query string ignored — `?token=` is how the beacon authenticates. */
export const isOtlpTraces = (req: IncomingMessage): boolean => (req.url ?? "").split("?")[0] === OTLP_TRACES_PATH;

/**
 * Options for `app.useBodyParser("text", …)`, registered **before** the global JSON parser.
 *
 * The body is read as text whatever its content type and parsed as JSON by the controller. That is
 * the whole point: the page's final flush goes through `navigator.sendBeacon`, which cannot set a
 * header and must stay a CORS-simple request — so it arrives as `text/plain`, and the JSON parser
 * would leave it unread. Reading it here for both types means one parse, one error path, and one
 * byte ceiling. The global JSON parser then sees a finished request and skips it.
 *
 * `type` as a function is body-parser's own hook: it limits the reader to this path, so every other
 * route keeps the JSON parser it always had.
 */
export const OTLP_BODY_PARSER = { type: isOtlpTraces, limit: OTLP_BODY_LIMIT };

/** Ten minutes. Long enough to spare a preflight per flush, short enough that a new token's origin is answered soon. */
const PREFLIGHT_MAX_AGE_SECONDS = "600";

/**
 * CORS for the OTLP route only — the same "a wall with one door" stance as `ingest-cors.ts`, with
 * the allowlist read from the tokens instead of from the environment.
 *
 * A preflight carries no token, so it is answered for any origin that belongs to *some* active
 * token; the POST is then held to its own token's list by the controller (403 otherwise). The
 * allow headers are sent on the POST too, so a page whose origin is refused can read the 403
 * rather than seeing an opaque network error.
 *
 * `Timing-Allow-Origin` follows the same rule as `Access-Control-Allow-Origin`. The Officina apps
 * show the bytes they sent to their telemetry host, measured with the Resource Timing API — and
 * without TAO the browser reports zero sizes for every cross-origin request, so the one number
 * meant to prove the telemetry's cost would claim it costs nothing.
 *
 * A lookup failure answers "not allowed" rather than an error: a preflight that 500s tells the
 * browser nothing more than a missing header does, and the POST it guards would be refused anyway.
 */
export function buildOtlpCors(registry: OriginCheck) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.path !== OTLP_TRACES_PATH) {
      next();
      return;
    }

    const origin = req.headers.origin;
    if (typeof origin === "string") {
      // The answer depends on the requester; a cache must never hand one page's answer to another.
      res.setHeader("Vary", "Origin");

      const known = await registry.isKnownOrigin(origin).catch((error: unknown) => {
        logger.warn({ err: error }, "otlp cors: could not read the token origins");
        return false;
      });
      if (known) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Timing-Allow-Origin", origin);
      }
    }

    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "POST");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Iknos-Token");
      res.setHeader("Access-Control-Max-Age", PREFLIGHT_MAX_AGE_SECONDS);
      // 204 whatever the verdict; a refused page learns only what the missing header tells it.
      res.status(204).end();
      return;
    }

    next();
  };
}
