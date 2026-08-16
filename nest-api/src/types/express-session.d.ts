import "express-session";

/**
 * What Iknos keeps in a session. Declared once here so `req.session.userId` is typed everywhere
 * instead of being cast at each use site — the casts are what let a typo compile.
 *
 * Both optional: express-session hands out an empty session object before login, and the guard
 * (Task 9) is what turns "userId is set" into an authenticated request.
 */
declare module "express-session" {
  interface SessionData {
    userId?: number;
    csrfToken?: string;
  }
}
