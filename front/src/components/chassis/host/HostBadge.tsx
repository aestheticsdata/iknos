"use client";

import { Modal } from "@components/ui/Modal";
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

type HostBadgeProps = {
  label: string;
};

/**
 * The `ks-b` badge, and the door to the machine panel (IKN-25).
 *
 * The badge was inert until this ticket, and an inert badge is never opened — so it now carries
 * the machine's state: its border turns amber or red the moment the disk crosses the alert rule's
 * line, on the next poll and without a reload. That is what gives anyone a reason to click it.
 *
 * The panel is an overlay, not a page: the machine is something you glance at on the way past, and
 * `esc` puts you back on exactly the view you left — the range, the selection and the scroll are
 * all untouched, because nothing underneath was navigated away from.
 */
export const HostBadge = ({ label }: HostBadgeProps) => {
  const [open, setOpen] = useState(false);
  const [range] = useTimeRange();
  const { tz } = useZone();
  const now = useHostNow();
  const series = useHostSeries(range, open);

  const level = now.data?.level ?? HOST_LEVEL.unknown;
  const sampledAt = now.data?.reading?.sampledAt ?? null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={badgeHint(now.data, label)}
        className={cn(
          "rounded-chip border px-1.5 py-0.5 text-kicker tracking-kicker transition-colors duration-150 ease-out",
          BADGE_CLASS[BADGE_TONE[level]],
        )}
        data-testid="host-badge"
        data-level={level}
      >
        {label}
        {/* The colour in words, for whoever cannot see it — the title is not announced on focus everywhere. */}
        <span className="sr-only">{` — ${HOST_TEXT.levelWord[level]}`}</span>
      </button>

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
