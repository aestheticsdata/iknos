/**
 * Shared between the middleware that sets the cookie and the controller that clears it on
 * logout (Task 10). Two string literals that must match are two string literals that will
 * eventually stop matching.
 */
export const SESSION_COOKIE_NAME = "iknos.sid";

/**
 * Rolling: every request pushes the expiry back, so the clock measures inactivity rather than
 * age.
 *
 * Two hours, against PFA's ten minutes. Deliberate: a dashboard lives in a tab and gets looked
 * at when something breaks. A ten-minute window would mean logging in before every glance, and
 * the account it protects is a single operator's, not a bank's.
 */
export const SESSION_TTL_SECONDS = 2 * 60 * 60;
