"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DEFAULT_ZONE, resolveZone, ZONE_KEYS, zoneAbbrev } from "./zone";

import type { Zone } from "./zone";

/**
 * Which clock the reader is on — IKN-38.
 *
 * A provider rather than URL state, and that is a deliberate break from the house rule. Everything
 * that *scopes* a view lives in the query string precisely so a link reproduces it: the service,
 * the range, the filters, the pinned window. The zone scopes nothing. It changes no query, moves
 * no boundary, and returns no different rows — the `from`/`to` a link carries stay UTC either way,
 * so two people opening the same link are still looking at the same instants, each on their own
 * clock. Putting a reader preference in the address bar would mean the sender's habits travel with
 * every link they paste.
 *
 * It is also the app's first use of `localStorage`, which is worth saying out loud rather than
 * leaving to be discovered.
 */

/** Namespaced like the session cookie (`iknos.sid`), so one glance at storage says whose it is. */
const STORAGE_KEY = "iknos.tz";

type ZoneContextValue = {
  /**
   * The IANA zone to format in — `"UTC"` until mounted, which is what the server resolves to and
   * therefore the only value that hydrates without a mismatch.
   */
  tz: string;
  /**
   * `null` until mounted. Anything that *names* the zone must wait for this, because the server
   * cannot know it; anything that merely formats an instant can use `tz` freely, since no
   * timestamp reaches the server renderer — the rows and the axis both arrive from a client fetch.
   */
  zone: Zone | null;
  /**
   * The offset actually in force — `CEST` in August, `CET` in January, `UTC` for UTC. `null` until
   * mounted, for the same reason `zone` is.
   *
   * Taken at mount rather than per render: it changes twice a year, and a panel left open across
   * the last Sunday in October is one reload away from catching up. Recomputing it on every row
   * would buy that one afternoon and cost an `Intl` call per frame.
   */
  abbrev: string | null;
  /** What pressing the toggle would switch to, named the same way. */
  otherAbbrev: string | null;
  /**
   * How many times the toggle has been pressed in this tab — the zone flash's clock, IKN-47.
   *
   * Two things are asked of it and one number answers both. `0` means *never pressed*, which is
   * what keeps the flash from firing on its own at mount, when the zone arrives from
   * `localStorage` and nothing was decided by anybody. And its parity is what alternates the two
   * animation names the chassis wears, because a CSS animation restarts only when its name
   * changes — re-applying the class it already has is a no-op, and pressing the toggle twice has
   * to flash twice.
   *
   * It is raised in the same `setState` as the zone, which is what makes the flash and the new
   * digits one commit and therefore one paint. Split across two updates they would be two events
   * a frame apart, which is exactly what this is meant not to look like.
   */
  pulse: number;
  toggle: () => void;
};

const ZoneContext = createContext<ZoneContextValue | null>(null);

const isZone = (value: unknown): value is Zone => ZONE_KEYS.includes(value as Zone);

/**
 * Storage access is wrapped because it throws rather than returns in Safari's private mode, and a
 * monitoring panel that renders a blank screen over a *preference* would be a poor trade. Failing
 * to read means the default; failing to write means the choice lasts for the session and no more.
 */
function readStored(): Zone {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isZone(stored) ? stored : DEFAULT_ZONE;
  } catch {
    return DEFAULT_ZONE;
  }
}

export const ZoneProvider = ({ children }: { children: React.ReactNode }) => {
  /*
   * The one mount gate in the app, and the reason there is only one: both halves of the problem
   * are unanswerable on the server. `localStorage` does not exist there, and the runtime zone
   * resolves to `Etc/UTC` because that is what ks-b is. Reading either during render would make
   * the first client paint disagree with the HTML — the same disagreement `TopBar`'s clock has
   * always deferred an effect to avoid.
   */
  const [state, setState] = useState<{ zone: Zone; at: Date; pulse: number } | null>(null);

  useEffect(() => setState({ zone: readStored(), at: new Date(), pulse: 0 }), []);

  const toggle = useCallback(() => {
    setState((current) => {
      if (current === null) return current;

      const next: Zone = current.zone === "utc" ? "local" : "utc";
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // The choice still applies to this tab; it simply will not outlive it.
      }
      return { ...current, zone: next, pulse: current.pulse + 1 };
    });
  }, []);

  const value = useMemo<ZoneContextValue>(() => {
    if (state === null) return { tz: "UTC", zone: null, abbrev: null, otherAbbrev: null, pulse: 0, toggle };

    const tz = resolveZone(state.zone);
    const other = resolveZone(state.zone === "utc" ? "local" : "utc");
    return {
      tz,
      zone: state.zone,
      abbrev: zoneAbbrev(tz, state.at),
      otherAbbrev: zoneAbbrev(other, state.at),
      pulse: state.pulse,
      toggle,
    };
  }, [state, toggle]);

  return <ZoneContext.Provider value={value}>{children}</ZoneContext.Provider>;
};

/** Throws rather than defaulting: a panel silently stuck in UTC is the exact bug this ticket is. */
export const useZone = (): ZoneContextValue => {
  const context = useContext(ZoneContext);
  if (context === null) throw new Error("useZone must be used inside a <ZoneProvider>");
  return context;
};
