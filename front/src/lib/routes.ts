/**
 * Every path in one place — `trailingSlash: true` means these are compared with the slash stripped.
 *
 * `logs` was the only view in M1; `service` joins it with IKN-13. Metrics, issues and alerts are
 * still absent rather than disabled: a view whose data does not exist yet is not in the list until
 * it does (§4). They join this object with the tickets that can answer them — IKN-23, IKN-14,
 * IKN-15.
 */
export const ROUTES = {
  login: "/login",
  register: "/register",
  recover: "/recover",
  about: "/about",
  logs: "/logs",
  /** Scoped to one service — the rail's selection is the whole of its input. */
  service: "/service",
  /** The internal primitive gallery. Reachable, deliberately not in the rail. */
  design: "/design",
} as const;

/**
 * The views that read the log query out of the URL.
 *
 * `/logs` is the panel at full width and `/service` embeds the same component, so a ⌘K hit that
 * sets a filter or opens a trace is answered on either — and the palette must not bounce someone
 * off the service view to show them something that view was already showing. Anywhere else, a
 * filter would be set on a page that does not read it, which is why the list exists rather than a
 * single comparison against `logs`.
 */
export const LOG_QUERY_VIEWS: readonly string[] = [ROUTES.logs, ROUTES.service];

/**
 * Where `/` sends a signed-in visitor.
 *
 * Still the log view, and deliberately, now that there is a second one to choose from: the service
 * view answers about a single service and the rail's default selection is `all`, so landing there
 * would open the app on a sentence asking the visitor to pick something. The logs answer without a
 * selection.
 */
export const HOME = ROUTES.logs;
