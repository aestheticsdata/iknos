/**
 * Every path in one place — `trailingSlash: true` means these are compared with the slash stripped.
 *
 * Four for now. The chassis and its views arrive with the rest of IKN-5; `/` belongs to the static
 * mock until then, which is why it is not in here.
 */
export const ROUTES = {
  login: "/login",
  register: "/register",
  recover: "/recover",
  about: "/about",
} as const;
