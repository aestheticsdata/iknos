"use client";

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
export const api = (path: string, options?: AxiosRequestConfig): Promise<AxiosResponse> =>
  axios(apiUrl(path), { withCredentials: true, ...options });

export const postJson = (path: string, data: unknown): Promise<AxiosResponse> => api(path, { method: "POST", data });

/** The HTTP status, or 0 for a request that never reached the API at all. */
export const statusOf = (error: unknown): number => (axios.isAxiosError(error) ? (error.response?.status ?? 0) : 0);

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
