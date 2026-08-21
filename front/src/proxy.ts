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
   * Everything except Next's own assets and the site's icons. The fonts are self-hosted under
   * `/_next/static`, so excluding that prefix also keeps the login screen from redirecting its
   * own typeface.
   *
   * `webmanifest` is in the list for the same reason the image extensions are, and it had to be
   * added by hand (IKN-33): without it a signed-out visitor's browser asks for the manifest, is
   * redirected to `/login`, and is handed an HTML page where it expected JSON. The manifest holds
   * the app's name, its two chassis colours and three icon URLs — there is nothing in it a login
   * screen does not already show.
   *
   * **`api` is excluded, and without it signing in is impossible in development.** This middleware
   * guards *pages*; the API guards itself, on every single call, with a real Redis lookup that the
   * Edge runtime cannot make. On ks-b the distinction never comes up because nginx routes `/api/*`
   * straight to Nest and Next never sees it — but on localhost the dev rewrite carries those calls
   * through Next, so `POST /api/auth/login` arrived here with no session cookie yet, matched no
   * public path, and was redirected to `/login`. The request that exists to create a session was
   * the one request a missing session bounced, and the sign-in form simply reloaded itself.
   *
   * It survived because the check is presence-only: any stale `iknos.sid` from an earlier session
   * lets everything through, so it reproduces only on a clean profile — or immediately after
   * signing out, which is the worst possible moment to find it.
   */
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest)$).*)"],
};
