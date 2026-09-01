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
 * Twelve hours, against PFA's ten minutes. Deliberate, twice: a dashboard lives in a tab and
 * gets looked at when something breaks, so a short window means logging in before every glance —
 * and the two-hour value this replaced still expired mid-workday and mid-demo, which is the one
 * moment a monitoring tool must not ask who you are. The account it protects is a single
 * operator's, not a bank's; a working day is the honest unit of inactivity.
 */
export const SESSION_TTL_SECONDS = 12 * 60 * 60;
