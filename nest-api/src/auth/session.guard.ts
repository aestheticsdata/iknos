import { ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { verifyCsrf } from "./csrf.util";
import { IS_PUBLIC } from "./public.decorator";

import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Shared with the front, which has to send it back on every mutation. */
export const CSRF_HEADER = "x-csrf-token";

/**
 * Registered as `APP_GUARD`, never controller by controller.
 *
 * That distinction is the whole design: a controller added six months from now is protected
 * because it exists, not because whoever wrote it remembered to decorate it. Opting *out* is
 * the visible act — `@Public()` — and opting out is what gets reviewed.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    // No store lookup and nothing async: the session middleware already verified the cookie's
    // signature, loaded the record out of Redis and slid its TTL. By the time a guard runs,
    // `req.session.userId` is either set or the cookie was never valid.
    const req = context.switchToHttp().getRequest<Request>();
    if (!req.session?.userId) throw new UnauthorizedException();

    // Checked after the session, deliberately: an anonymous caller gets 401 rather than 403,
    // because "your token was wrong" is a strange thing to tell someone who has no session to
    // hold a token in.
    if (!SAFE_METHODS.has(req.method)) {
      const provided = req.headers[CSRF_HEADER];
      if (!verifyCsrf(req.session.csrfToken ?? "", typeof provided === "string" ? provided : "")) {
        throw new ForbiddenException();
      }
    }

    return true;
  }
}
