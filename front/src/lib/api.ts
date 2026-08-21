"use client";

import { ROUTES } from "@lib/routes";
import axios from "axios";

import type { AxiosRequestConfig, AxiosResponse } from "axios";

/**
 * In production the front and the API share an origin behind nginx, so the base is empty and every
 * request is same-origin. Only a browser on localhost needs telling where the API is — that is what
 * `NEXT_PUBLIC_REMOTE_HOST_FROM_LOCALHOST` is for, exactly as in pfa and Zeus.
 */
const apiBase = (): string => {
  if (typeof window !== "undefined" && window.location.hostname === "localhost") {
    return process.env.NEXT_PUBLIC_REMOTE_HOST_FROM_LOCALHOST ?? "";
  }
  return "";
};

const apiUrl = (path: string): string => `${apiBase()}/api${path.startsWith("/") ? path : `/${path}`}`;

/**
 * `withCredentials` on every call, including the ones that have no session yet: the response to
 * `POST /auth/login` is what *sets* `iknos.sid`, and without this the browser drops it on the floor
 * and the next request is anonymous — a sign-in that reports success and changes nothing.
 *
 * No CSRF header anywhere in this file. The three routes the auth screens call are `@Public()`, and
 * the guard returns before it reaches the CSRF check — the token is issued at login and matters
 * only once there is a session to protect.
 */
const send = (path: string, options?: AxiosRequestConfig): Promise<AxiosResponse> =>
  axios(apiUrl(path), { withCredentials: true, ...options });

/** The HTTP status, or 0 for a request that never reached the API at all. */
export const statusOf = (error: unknown): number => (axios.isAxiosError(error) ? (error.response?.status ?? 0) : 0);

/**
 * Leave for the sign-in screen, and say so — returns whether it is actually going.
 *
 * A **hard** navigation, not `router.replace`: the chassis is a server component tree rendered with
 * a cookie that no longer resolves to anything, and a soft navigation would carry that render, its
 * router cache and the log hooks' state along with it. `window.location.replace` rather than
 * `.href`, so the dead page does not become a back-button destination that immediately bounces.
 *
 * `?expired=1` is the whole UX half of IKN-44: landing on a bare login form after a tab has been
 * open all afternoon reads as the app having logged you out for no reason, or as a bug.
 *
 * Returns false when there is nowhere to go — during SSR, or when this *is* the login screen, where
 * a 401 means "wrong password" and the form has its own thing to say about it.
 */
const leaveForLogin = (): boolean => {
  if (typeof window === "undefined") return false;
  // `trailingSlash: true`, so the live path is `/login/` — compared with the slash stripped, the
  // same way `proxy.ts` does it.
  if (window.location.pathname.replace(/\/+$/, "") === ROUTES.login) return false;

  window.location.replace(`${ROUTES.login}?expired=1`);
  return true;
};

/**
 * A call that needs the session — every route the app group touches, and the CSRF token with them.
 *
 * **A 401 is not an error to render, it is a session that is gone.** Before IKN-44 it travelled all
 * the way out to `readApiError` and was painted as a red "unauthorized" over an empty log panel,
 * where the only way out was to guess that a reload would help. The promise returned on that path
 * never settles, deliberately: the browser is already navigating, and settling it either way would
 * let a `catch` paint that banner over the screen being left behind.
 *
 * Aborts are not 401s and never come through here — `statusOf` answers 0 for a request that carried
 * no response at all, which is also what a dead API gives, and neither is grounds for signing out.
 */
export const api = async (path: string, options?: AxiosRequestConfig): Promise<AxiosResponse> => {
  try {
    return await send(path, options);
  } catch (error) {
    if (statusOf(error) === 401 && leaveForLogin()) return new Promise<never>(() => {});
    throw error;
  }
};

/**
 * The auth screens' POST — login, register, recover — and **not** `api`.
 *
 * All three are `@Public()`, and all three answer 401 for a credential that is simply wrong. Routed
 * through the redirect above, a mistyped password on `/recover` would silently throw the form away
 * and reload the login screen claiming the session had expired.
 */
export const postJson = (path: string, data: unknown): Promise<AxiosResponse> => send(path, { method: "POST", data });

/**
 * The message the API meant to show, rather than "Request failed with status code 500".
 *
 * Nest's ValidationPipe answers with an *array* of messages, one per failed rule. The first is the
 * one to show: they arrive in field order, and a stack of four red lines under a form is read as
 * "everything is wrong" rather than as four separate things.
 */
export const readApiError = (error: unknown, fallback: string): string => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string | string[] } | undefined;
    if (Array.isArray(data?.message)) return data.message[0] ?? fallback;
    if (typeof data?.message === "string") return data.message;
  }
  return fallback;
};
