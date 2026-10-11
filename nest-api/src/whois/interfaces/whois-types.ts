/** The slice of `fetch` the lookup uses — injectable, so tests never open a socket. */
export type WhoisFetch = (url: string, init: RequestInit) => Promise<WhoisResponse>;

/** As much of a `Response` as the lookup reads. */
export type WhoisResponse = Pick<Response, "status" | "text">;

/**
 * Where answers are kept between clicks. Redis in the app; a `Map` in the specs.
 *
 * Both methods may throw — Redis is shared and can be down — and the service treats a throw as a
 * miss or a skipped write, never as a failed lookup.
 */
export type WhoisCache = {
  get: (key: string) => Promise<string | null>;
  set: (entry: WhoisCacheEntry) => Promise<void>;
};

export type WhoisCacheEntry = { key: string; value: string; ttlSeconds: number };
