"use client";

import { SURFACE_TEXT, SURFACE_TEXT_DIM, SURFACE_TEXT_MUTED, TONE_FILL, TONE_TEXT } from "@components/ui/surface";
import { formatDuration, formatValue, openFor, SEVERITY_TONE } from "@lib/alertFormat";
import { cn } from "@lib/utils";
import { ALERTS_TEXT } from "@text/alerts";

import type { AlertRow } from "@lib/alertTypes";

/**
 * One alert, as the mockup draws it: a state badge and a duration, the rule's expression, then the
 * service and its current reading (§5.5).
 *
 * **The expression is the headline, not the title.** IKN-15 is explicit about why: a French label
 * can never tell a reader whether the alert is wrong or the threshold is, and `rate(http_5xx[10m])
 * > 5%` can. The title is there for the row that has no room for both.
 *
 * A firing card carries the error ground and a left rule in its severity; a pending one carries
 * neither, because it has not yet earned the attention. That is the mockup's own distinction
 * between `.alert` and `.alert.firing`.
 */
export const AlertCard = ({ alert, now, onOpen }: { alert: AlertRow; now: number; onOpen: () => void }) => {
  const tone = SEVERITY_TONE[alert.severity];
  const firing = alert.state === "firing";

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "w-full border-work-border border-b border-l-3 px-2.75 py-2.25 text-left transition-colors duration-150 ease-out last:border-b-0",
        // The left rule is the severity, always — it is what makes a column of these scannable.
        TONE_FILL.work[tone].replace("bg-", "border-l-"),
        firing ? "bg-work-error-bg hover:brightness-[1.04]" : "hover:bg-work-inset",
      )}
    >
      <div className="mb-1 flex items-center gap-1.75">
        <span
          className={cn(
            "rounded-chip px-1.5 py-0.5 text-kicker tracking-kicker uppercase",
            "bg-work-inset",
            TONE_TEXT.work[tone],
          )}
        >
          {ALERTS_TEXT.states[alert.state]}
        </span>
        <span className={cn("text-micro tabular-nums", TONE_TEXT.work[tone])}>
          {ALERTS_TEXT.since(formatDuration(openFor(alert, now)))}
        </span>
      </div>

      {/* Verbatim, and `break-all` because an expression is one unbreakable token to a browser. */}
      <p className={cn("text-row leading-snug break-all", SURFACE_TEXT.work)}>{alert.expr}</p>

      <p className={cn("mt-0.75 text-micro", SURFACE_TEXT_MUTED.work)}>
        {alert.service} ·{" "}
        <span className={cn("font-medium", alert.value === null ? SURFACE_TEXT_DIM.work : TONE_TEXT.work[tone])}>
          {/* `—` when there is no reading. Never a zero — see `formatValue`. */}
          {formatValue(alert.value, alert.unit)}
        </span>
      </p>
    </button>
  );
};
