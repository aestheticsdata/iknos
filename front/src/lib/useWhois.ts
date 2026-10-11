"use client";

import { api, readApiError } from "@lib/api";
import { whoisUrl } from "@lib/logQuery";
import { LOGS_TEXT } from "@text/logs";
import { useEffect, useRef, useState } from "react";

import type { IpWhois, WhoisLookup } from "@lib/interfaces/whoisTypes";

/** What a lookup is about, tagged so an answer for one address is never shown under another. */
type Asked = { ip: string; answer: IpWhois | null; error: string | null };

/**
 * Whois for one address, fetched on `lookup()` and at no other time (IKN-73).
 *
 * **No effect fetches here.** The request starts in the click handler, so mounting, re-rendering,
 * a live tail scrolling past or a modal changing rows can never send one — the ticket's hard rule,
 * held by there being no code path that could break it.
 *
 * Tagged with the address it was asked about, like `usePolledResource`'s identity: the row detail
 * stays mounted while its row changes, and the previous line's answer must not sit under the next
 * line's address looking like it belongs there.
 *
 * The provider's own failures are not errors here — the API answers them as an `unknown` with a
 * reason. `error` is only the API itself being unreachable.
 */
export const useWhois = (ip: string | null): WhoisLookup => {
  const [asked, setAsked] = useState<Asked | null>(null);
  const controller = useRef<AbortController | null>(null);

  // Nobody is waiting for an answer once the control is gone.
  useEffect(() => () => controller.current?.abort(), []);

  const current = ip !== null && asked?.ip === ip ? asked : null;

  const lookup = () => {
    if (ip === null) return;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setAsked({ ip, answer: null, error: null });

    void (async () => {
      try {
        const response = await api(whoisUrl(ip), { signal: next.signal });
        if (!next.signal.aborted) setAsked({ ip, answer: response.data as IpWhois, error: null });
      } catch (failure) {
        if (next.signal.aborted) return;
        setAsked({ ip, answer: null, error: readApiError(failure, LOGS_TEXT.whoisFailed) });
      }
    })();
  };

  return {
    requested: current !== null,
    loading: current !== null && current.answer === null && current.error === null,
    answer: current?.answer ?? null,
    error: current?.error ?? null,
    lookup,
  };
};
