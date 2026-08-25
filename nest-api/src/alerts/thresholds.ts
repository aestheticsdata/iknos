/**
 * Every number the six rules test against, in one file (IKN-10).
 *
 * **Consts, not configuration** — spec D3, and it reverses what the ticket asked for. The ticket
 * predates the convention: every threshold in this product is an exported const with a colocated
 * spec (`STALE_AFTER_MS`, `LOOP_LAG_FULL_MS`, the issue recency tiers), and each env knob is a
 * five-file edit by written contract. What the ticket actually wanted — that the UI never
 * redeclares a threshold — is answered by storing the threshold **on the alert row**, which is
 * the only shape that works at all given the front is a separate pnpm root and cannot import from
 * here.
 *
 * Several of these were chosen against measurements from ks-b rather than picked. Where that is
 * true the comment says what was measured, because the next person to change one deserves to know
 * what the old value was answering.
 */

/* ── health_down ────────────────────────────────────────────────────────────────────────────── */

/** Probes land every 30 s, so two failures is a minute of being down. */
export const HEALTH_FAILURES = 2;

/**
 * The window those two failures must fall inside.
 *
 * **A window, not `ORDER BY ts DESC LIMIT 2`.** The engine runs every 60 s and probes land every
 * 30 s, so a pass that runs slightly late would step straight over a pair with the `LIMIT` form
 * and never see the outage at all. 90 s is the same span `STALE_AFTER_MS` was sized against.
 */
export const HEALTH_WINDOW_MS = 90_000;

/* ── process_restart ────────────────────────────────────────────────────────────────────────── */

/** Long enough that a restart is still news on the next pass, short enough to be one incident. */
export const RESTART_WINDOW_MS = 10 * 60_000;

/* ── no_logs ────────────────────────────────────────────────────────────────────────────────── */

/**
 * The three constants below are why this rule is not the one the ticket describes.
 *
 * IKN-10 asks for "no line from a service in 15 minutes". Measured against ks-b, that fires for
 * most of the fleet every night: of nineteen enabled services, eight logged nothing at all in
 * twenty-four hours, and of the eleven that did, the *worst gap* was 19 h for `iknos-front` and
 * 10 h for the three busiest — `worldweathr-api` averages a line every 17 s and still goes quiet
 * for ten hours overnight. A threshold above those gaps would be a day wide and worth nothing.
 *
 * So the predicate is not "quiet" but **"was busy, then stopped"**: a service that logged at
 * least `BUSY_MIN_LINES` in the hour before last, and nothing since. A service that is merely
 * idle never satisfies the first half, and a service that dies mid-traffic satisfies both within
 * one pass. That is the failure anybody wanted an alert for.
 */
export const SILENCE_AFTER_MS = 15 * 60_000;

/** How far back "was it busy" looks, ending where the silence window begins. */
export const BUSY_WINDOW_MS = 60 * 60_000;

/** A line a minute across that hour. Below this, silence is not evidence of anything. */
export const BUSY_MIN_LINES = 60;

/* ── disk_space ─────────────────────────────────────────────────────────────────────────────── */

/**
 * The pair IKN-25's machine panel will import when it arrives.
 *
 * IKN-10 says these must be "the same source" as the panel's colours. There is no such source in
 * either direction today — IKN-25 has no code at all, no disk percentage is computed anywhere in
 * the repo, and `host_sample`'s disk columns have never been read back by anything. So the shared
 * source is *created here*, and the requirement becomes a constraint on IKN-25: import these,
 * never restate them.
 */
export const DISK_WARN_PCT = 85;
export const DISK_CRITICAL_PCT = 95;

/** A five-minute `for`. Disk crossing a line and coming back is a log rotation, not an incident. */
export const DISK_FOR_MS = 5 * 60_000;

/* ── error_rate / latency_p95 ───────────────────────────────────────────────────────────────── */

/** The range both metric rules ask `SignalsService` for. */
export const METRIC_WINDOW_MS = 10 * 60_000;

/**
 * `errorRate.value` is a **percent on 0–100**, so this is 5 and not 0.05. Reading it as a fraction
 * makes the rule fire on every service that has ever served a 500.
 */
export const ERROR_RATE_PCT = 5;

/** `p95.value` is **milliseconds**. One second, not one. */
export const LATENCY_P95_MS = 1_000;

/** Both metric rules wait this long. A single bad minute inside a ten-minute window is weather. */
export const METRIC_FOR_MS = 5 * 60_000;
