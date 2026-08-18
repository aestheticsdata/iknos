import { NextResponse } from "next/server";

import type { NextRequest } from "next/server";

/**
 * The redirect half of IKN-6's "no session, no page".
 *
 * `proxy.ts`, not `middleware.ts`: Next 16 renamed the convention and warns on the old name.
 *
 * **Presence only, never validation.** This runs on the Edge runtime, where the Redis client
 * does not work — so asking "is this session real?" here is not an option, and pretending to would
 * be worse than not asking. Nest revalidates on every single call (`SessionGuard`, registered as
 * `APP_GUARD`), so a forged cookie buys nothing but an empty chassis and a column of 401s.
 *
 * What this does buy is that a signed-out visitor lands on `/login` instead of on a shell that
 * renders, flickers, and then fails.
 */
const SESSION_COOKIE = "iknos.sid";

/** The four screens that exist to be reached without a session. */
const PUBLIC_PATHS = ["/login", "/register", "/recover", "/about"];

export function proxy(request: NextRequest) {
  // `trailingSlash: true`, so compare with the slash stripped — otherwise `/login/` is not
  // `/login` and the sign-in page redirects to itself, forever.
  const path = request.nextUrl.pathname.replace(/\/+$/, "") || "/";

  if (PUBLIC_PATHS.includes(path)) return NextResponse.next();
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const login = new URL("/login", request.url);
  return NextResponse.redirect(login);
}

export const config = {
  /**
   * Everything except Next's own assets and the favicon. The fonts are self-hosted under
   * `/_next/static`, so excluding that prefix also keeps the login screen from redirecting its
   * own typeface.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
