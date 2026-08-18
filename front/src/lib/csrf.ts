"use client";

import { api } from "@lib/api";

/**
 * The CSRF token, fetched at the moment it is needed.
 *
 * Not cached in a module variable: the token rotates on login (IKN-6), so a copy taken once per
 * page load is stale for anyone who signs out and back in without a reload — and the failure is a
 * 403 on the *next* mutation, which reads as a broken button rather than as a stale token.
 */
export const readCsrfToken = async (): Promise<string> => {
  // `GET /api/csrf` — `@Controller("api")` + `@Get("csrf")`, and the field is `csrfToken`.
  const response = await api("/csrf");
  return (response.data as { csrfToken: string }).csrfToken;
};

/** A mutation with the header the guard checks. */
export const postWithCsrf = async (path: string): Promise<void> => {
  const token = await readCsrfToken();
  await api(path, { method: "POST", headers: { "x-csrf-token": token } });
};
