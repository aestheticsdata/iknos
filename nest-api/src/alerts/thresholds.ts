import { HOST_LEVEL, type HostLevel } from "@contracts/host";

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
 * The pair the machine panel (IKN-25) colours by.
 *
 * IKN-10 says these must be "the same source" as the panel's colours. The source is this file:
 * the host routes import `diskLevel` below and send the numbers to the front with every reading,
 * so neither the panel nor the badge restates them.
 */
export const DISK_WARN_PCT = 85;
export const DISK_CRITICAL_PCT = 95;

/**
 * Which side of those two lines a disk reading sits on — the comparison itself, shared.
 *
 * Sharing the numbers was not enough: the rule tests `>` and a panel testing `>=` would be green
 * at exactly 85.0 % for the five minutes the rule is already pending. So the panel imports the
 * comparison, not just the constants, and the two cannot disagree at the boundary.
 */
export function diskLevel(pct: number): HostLevel {
  if (pct > DISK_CRITICAL_PCT) return HOST_LEVEL.critical;
  if (pct > DISK_WARN_PCT) return HOST_LEVEL.warning;
  return HOST_LEVEL.ok;
}

/**
 * How old the newest `host_sample` row may be and still count as the machine's current state.
 *
 * The sampler writes every 30 s; ten minutes is twenty missed readings, past which "the newest
 * row" describes a sampler that has stopped, not a machine. The disk rule and the panel read the
 * same window, so the badge cannot go grey while the rule still believes a reading.
 */
export const HOST_SAMPLE_FRESH_MS = 10 * 60_000;

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
