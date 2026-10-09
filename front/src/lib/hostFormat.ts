import { HOST_LEVEL } from "@lib/interfaces/hostTypes";
import { HOST_TEXT } from "@text/host";

import type { Tone } from "@components/ui/surface";
import type { HostLevel, HostNow } from "@lib/interfaces/hostTypes";

/**
 * What the machine panel and the `ks-b` badge paint a level in (IKN-25).
 *
 * The levels arrive from the API, decided there by the alert rule's own comparison — nothing here
 * compares a percentage to a threshold. This file only says which colour each verdict wears.
 */

/** A gauge's bar and chart. `none` and `unknown` are grey: no rule checked them, or nothing was read. */
export const GAUGE_TONE: Record<HostLevel, Tone> = {
  [HOST_LEVEL.ok]: "ok",
  [HOST_LEVEL.warning]: "warn",
  [HOST_LEVEL.critical]: "error",
  [HOST_LEVEL.none]: "neutral",
  [HOST_LEVEL.unknown]: "neutral",
};

/**
 * The badge. Quiet at `ok` — it is permanent chrome, and a green chip that never changes is one
 * nobody reads by the end of the week. It changes colour only on a crossing, which is the reason
 * to click it.
 */
export const BADGE_TONE: Record<HostLevel, Tone> = {
  ...GAUGE_TONE,
  [HOST_LEVEL.ok]: "neutral",
};

/**
 * `84.6` — one decimal, always.
 *
 * Not `formatPercent`, which rounds past ten to whole numbers: 84.6 % printed as `85` beside a line
 * at 85 % would look like a breach the bar is not showing. One decimal is also what `htop` prints.
 */
export const formatHostPct = (pct: number | null): string =>
  pct === null || !Number.isFinite(pct) ? HOST_TEXT.absent : pct.toFixed(1);

/** `0.42` — the two decimals `uptime` and `htop` print a load average at. */
export const formatLoad = (load: number): string => (Number.isFinite(load) ? load.toFixed(2) : HOST_TEXT.absent);

/** The badge's title: the host, the level in words, and the disk figure when there is one. */
export const badgeHint = (now: HostNow | null, host: string): string => {
  const level = now?.level ?? HOST_LEVEL.unknown;
  const disk = now?.reading?.disk.pct ?? null;
  const detail = disk === null ? "" : HOST_TEXT.badgeDisk(formatHostPct(disk));

  return HOST_TEXT.badgeHint(host, HOST_TEXT.levelWord[level], detail);
};
