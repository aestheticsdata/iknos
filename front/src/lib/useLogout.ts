"use client";

import { postWithCsrf } from "@lib/csrf";
import { ROUTES } from "@lib/routes";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

/**
 * Signing out, from the rail's menu and from `⌘⇧L` alike (IKN-22).
 *
 * Shared rather than written twice, because the interesting half is the `finally`: the push
 * happens whether or not the request succeeded. A logout that failed server-side must still not
 * leave the chassis standing — the middleware bounces the next navigation once the cookie is gone,
 * and a shortcut that appears to do nothing is worse than one that leaves early.
 */
export const useLogout = (): (() => Promise<void>) => {
  const router = useRouter();

  return useCallback(async () => {
    try {
      // Authenticated, so it carries the CSRF header — unlike the four public auth routes.
      await postWithCsrf("/auth/logout");
    } finally {
      router.push(ROUTES.login);
    }
  }, [router]);
};
