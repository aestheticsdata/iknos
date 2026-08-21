"use client";

import { api } from "@lib/api";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

/**
 * The other half of IKN-44: something that *asks*.
 *
 * A 401 sends you to the login screen (`@lib/api`), but only if a request is made — and an idle
 * Iknos tab makes none worth the name. The tail is an `EventSource` retrying on its own schedule
 * behind a "reconnecting…" chip, and the histogram only re-anchors while the tab is visible. So a
 * session could die at 3pm and the screen would still be showing 2pm's logs at six, until a click
 * on `refresh` finally answered `unauthorized` over an empty panel.
 *
 * This is the same component pfa mounts under `(private)`, transposed: probe on coming back — the
 * window regaining focus, the tab becoming visible, the network coming back, a client-side
 * navigation — and let the shared 401 path do the rest.
 *
 * Renders nothing, and belongs to the app group alone: on `/login` a 401 is a wrong password.
 */

/**
 * A tab switch fires `focus` and `visibilitychange` together, and Chrome adds `online` on a laptop
 * waking up. Without a floor between them, coming back to Iknos costs three identical probes.
 */
const PROBE_THROTTLE_MS = 10_000;

export const SessionWatcher = () => {
  const pathname = usePathname();

  /**
   * Seeded to now rather than to 0, which is what suppresses the probe on mount.
   *
   * The chassis this sits in was rendered by `AppChassis`, which just called `/api/services` with
   * the same cookie and redirects here itself if the API refused it (IKN-44). The session is known
   * good for this page load; asking again a frame later would only be a second opinion on an answer
   * the server has already given.
   */
  const lastProbe = useRef(Date.now());

  const probe = useCallback(() => {
    const now = Date.now();
    if (now - lastProbe.current < PROBE_THROTTLE_MS) return;
    lastProbe.current = now;

    /*
     * `GET /api/me` — behind the session guard, so it answers 401 the moment the session is gone,
     * and safe, so it needs no CSRF token. Every *other* outcome is swallowed on purpose: a probe
     * that fails because the API is restarting or the wifi dropped must not throw anyone out. The
     * 401 is handled inside `api` and never reaches this `catch` — the promise it returns is the
     * one that never settles.
     */
    void api("/me").catch(() => {});
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") probe();
    };

    // Both, not one: `visibilitychange` covers switching tabs, `focus` covers switching *windows* —
    // going from the editor back to a browser that never hid the tab fires only the second.
    window.addEventListener("focus", probe);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", probe);

    return () => {
      window.removeEventListener("focus", probe);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", probe);
    };
  }, [probe]);

  // And on the first click after an idle spell, which navigates without ever raising a focus event.
  useEffect(() => {
    probe();
  }, [pathname, probe]);

  return null;
};
