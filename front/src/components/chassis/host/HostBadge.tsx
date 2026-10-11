"use client";

import { Modal } from "@components/ui/Modal";
import { Tooltip } from "@components/ui/Tooltip";
import { useTimeRange } from "@lib/chassisState";
import { BADGE_TONE, badgeHint } from "@lib/hostFormat";
import { HOST_LEVEL } from "@lib/interfaces/hostTypes";
import { useHostNow, useHostSeries } from "@lib/useHost";
import { cn } from "@lib/utils";
import { timeLabel } from "@lib/zone";
import { useZone } from "@lib/zoneState";
import { HOST_TEXT } from "@text/host";
import { useState } from "react";
import { HostPanel } from "./HostPanel";

import type { Tone } from "@components/ui/surface";

/** The chip's border and ink per tone. Quiet until a line is crossed — see `BADGE_TONE`. */
const BADGE_CLASS: Record<Tone, string> = {
  ok: "border-chassis-accent text-chassis-accent",
  warn: "border-chassis-warn text-chassis-warn",
  error: "border-chassis-error text-chassis-error",
  info: "border-chassis-info text-chassis-info",
  neutral: "border-chassis-border-strong text-chassis-text-muted hover:text-chassis-text",
};

/**
 * The host badge, and the door to the machine panel (IKN-25).
 *
 * **The name comes from the API, in the poll the badge already makes** (IKN-65) — `IKNOS_HOST_LABEL`
 * on the server, else its hostname. It was a `ks-b` constant in the front, which was true on ks-b
 * by coincidence and confidently false everywhere else. Until the first answer lands the badge says
 * `host`, in the same box: a blank chip would be a badge that had nothing to say, and a guessed
 * name would be the old lie for one poll.
 *
 * The badge was inert until this ticket, and an inert badge is never opened — so it now carries
 * the machine's state: its border turns amber or red the moment the disk crosses the alert rule's
 * line, on the next poll and without a reload. That is what gives anyone a reason to click it.
 *
 * The panel is an overlay, not a page: the machine is something you glance at on the way past, and
 * `esc` puts you back on exactly the view you left — the range, the selection and the scroll are
 * all untouched, because nothing underneath was navigated away from.
 */
export const HostBadge = () => {
  const [open, setOpen] = useState(false);
  const [range] = useTimeRange();
  const { tz } = useZone();
  const now = useHostNow();
  const series = useHostSeries(range, open);

  const label = now.data?.host ?? HOST_TEXT.pendingLabel;
  const level = now.data?.level ?? HOST_LEVEL.unknown;
  const sampledAt = now.data?.reading?.sampledAt ?? null;

  return (
    <>
      <Tooltip
        mode="hover"
        content={badgeHint(now.data, label)}
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "rounded-chip border px-1.5 py-0.5 text-kicker tracking-kicker transition-colors duration-150 ease-out",
            BADGE_CLASS[BADGE_TONE[level]],
          )}
          data-testid="host-badge"
          data-level={level}
        >
          {label}
          {/* The colour in words, for whoever cannot see it — the bubble is not announced to every reader. */}
          <span className="sr-only">{` — ${HOST_TEXT.levelWord[level]}`}</span>
        </button>
      </Tooltip>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        testId="host-modal"
        tag={HOST_TEXT.tag}
        title={`${label} · ${HOST_TEXT.title}`}
        hint={
          sampledAt === null
            ? HOST_TEXT.everyThirty
            : `${HOST_TEXT.sampledAt(timeLabel(Date.parse(sampledAt), 1_000, tz))} · ${HOST_TEXT.everyThirty}`
        }
      >
        <HostPanel
          now={now.data}
          series={series}
          range={range}
        />
      </Modal>
    </>
  );
};
