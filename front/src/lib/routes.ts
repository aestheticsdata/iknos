/**
 * Every path in one place — `trailingSlash: true` means these are compared with the slash stripped.
 *
 * `logs` is the only view behind the session, and since IKN-13 it is the whole work area: the log
 * explorer when the rail is on `all`, one service's dashboard with the same panel underneath when
 * it is not. Metrics, issues and alerts are still absent rather than disabled — a view whose data
 * does not exist yet is not in the list until it does (§4) — and they join this object with the
 * tickets that can answer them: IKN-23, IKN-14, IKN-15.
 */
export const ROUTES = {
  login: "/login",
  register: "/register",
  recover: "/recover",
  about: "/about",
  logs: "/logs",
  /**
   * The view that was folded into `logs`. Still routed, and only so that the links shipped with it
   * keep working: the page at this path forwards to `logs` with the query string intact.
   */
  service: "/service",
  /** The internal primitive gallery. Reachable, deliberately not in the rail. */
  design: "/design",
} as const;

/**
 * The views that read the log query out of the URL.
 *
 * One entry today, and still a list rather than a comparison: a ⌘K hit that sets a filter or opens
 * a trace has to know whether the page it is on will *answer* it, and the day the metrics view
 * (IKN-23) reads the same query, adding it here is the whole change. Anywhere else — the design
 * gallery, an auth screen — a filter would be written onto a page that never reads it, which is
 * why the palette navigates first.
 */
export const LOG_QUERY_VIEWS: readonly string[] = [ROUTES.logs];

/** Where `/` sends a signed-in visitor: the work area, which answers with or without a selection. */
export const HOME = ROUTES.logs;
