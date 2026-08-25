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

/**
 * A mutation with the header the guard checks, and whatever it answered.
 *
 * One round trip more than the mutation itself, on purpose: see `readCsrfToken` above. The token is
 * cheap, comes from the session the mutation is about to use, and a stale copy costs a 403 on the
 * request that mattered.
 *
 * The response is returned rather than discarded so a caller that needs the new state does not have
 * to re-read it — the issue mutations answer `{ ok: true }` and want nothing, but the next one may.
 */
export const mutateWithCsrf = async <T = unknown>(
  path: string,
  options: { method?: "POST" | "PATCH" | "DELETE"; data?: unknown } = {},
): Promise<T> => {
  const token = await readCsrfToken();
  const response = await api(path, {
    method: options.method ?? "POST",
    headers: { "x-csrf-token": token },
    data: options.data,
  });

  return response.data as T;
};

/**
 * The bare POST, kept as it was.
 *
 * `useLogout` is its only caller and has nothing to send and nothing to read; widening its call
 * site to pass an empty object would be churn in the one place that has been right all along.
 */
export const postWithCsrf = async (path: string): Promise<void> => {
  await mutateWithCsrf(path);
};
