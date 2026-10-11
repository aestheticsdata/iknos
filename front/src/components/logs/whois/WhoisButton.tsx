"use client";

import { SURFACE_TEXT_DIM } from "@components/ui/surface";
import { Tooltip } from "@components/ui/Tooltip";
import { cn } from "@lib/utils";
import { LOGS_TEXT } from "@text/logs";

import type { WhoisLookup } from "@lib/interfaces/whoisTypes";

type WhoisButtonProps = {
  ip: string;
  whois: WhoisLookup;
};

/**
 * The one control that asks about an address (IKN-73) — the only way a whois request starts.
 *
 * Stops the click where it lands: both sites put it inside something clickable of its own (the
 * grouped row narrows the stream), and a lookup must not also be a filter. Disabled while its own
 * answer is in flight, so a double-click is one request rather than two.
 */
export const WhoisButton = ({ ip, whois }: WhoisButtonProps) => (
  <Tooltip
    mode="hover"
    content={LOGS_TEXT.whoisHint}
  >
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        whois.lookup();
      }}
      disabled={whois.loading}
      aria-label={LOGS_TEXT.whoisLabel(ip)}
      data-testid="whois-lookup"
      className={cn(
        "text-kicker transition-colors duration-150 ease-out hover:text-chassis-text disabled:opacity-60",
        SURFACE_TEXT_DIM.chassis,
      )}
    >
      {LOGS_TEXT.whois}
    </button>
  </Tooltip>
);
