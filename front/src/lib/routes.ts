/**
 * Every path in one place — `trailingSlash: true` means these are compared with the slash stripped.
 *
 * `logs` is the only view in M1. Metrics, issues and alerts are absent rather than disabled: a view
 * whose data does not exist yet is not in the list until it does (§4). They join this object with
 * the tickets that can answer them — IKN-23, IKN-14, IKN-15.
 */
export const ROUTES = {
  login: "/login",
  register: "/register",
  recover: "/recover",
  about: "/about",
  logs: "/logs",
  /** The internal primitive gallery. Reachable, deliberately not in the rail. */
  design: "/design",
} as const;

/** Where `/` sends a signed-in visitor: the one view M1 can fill. */
export const HOME = ROUTES.logs;
