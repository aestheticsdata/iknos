import type { NextFunction, Request, Response } from "express";

/**
 * CORS, for exactly one route.
 *
 * `POST /api/ingest` is the only endpoint a page on another domain is meant to call (IKN-29).
 * The Iknos front never needed this — nginx routes `/api/` on the same origin — so the gap only
 * shows the day another front of the fleet posts its first error: the browser preflights the
 * request (JSON body + `X-Iknos-Token` make it non-simple), the OPTIONS finds no CORS answer,
 * and the report dies in the browser with the API never seeing a byte. The reporter swallows
 * failures by design, so nothing anywhere says why.
 *
 * Hand-rolled rather than `app.enableCors`, because the scope is the point: every other route
 * serves one first-party UI and answering CORS on them would be an invitation to write a second
 * client. This stays a wall with one door.
 *
 * The allowlist is the same one the controller enforces on POST. An empty list means the origin
 * check is off (the config's documented meaning), so the origin is reflected — the token, the
 * service registry and the rate limit still stand, and CORS was never the guard anyway: it
 * protects users from pages, not servers from callers.
 */
export function buildIngestCors(origins: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.path !== "/api/ingest") {
      next();
      return;
    }

    const origin = req.headers.origin;
    if (typeof origin !== "string") {
      next();
      return;
    }

    if (origins.length === 0 || origins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      // The response varies by requester; a cache serving one page's answer to another would
      // either leak an allowance or break a legitimate sender.
      res.setHeader("Vary", "Origin");
    }

    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "POST");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Iknos-Token");
      // A day. The answer never changes at runtime, and one preflight per page load is already
      // one more round trip than the report itself.
      res.setHeader("Access-Control-Max-Age", "86400");
      // 204 unconditionally, allowed origin or not: the preflight is answered, and a disallowed
      // page learns nothing beyond what the missing allow-origin header already tells it.
      res.status(204).end();
      return;
    }

    next();
  };
}
