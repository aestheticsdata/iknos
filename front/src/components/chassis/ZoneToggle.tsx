"use client";

import { Button } from "@components/ui/Button";
import { cn } from "@lib/utils";
import { useZone } from "@lib/zoneState";
import { CHASSIS_TEXT } from "@text/chassis";

/**
 * Which clock the panel is read on — IKN-38.
 *
 * Last in the bar, to the right of the chassis clock, because the zone governs both: that clock
 * was the app's only local-time render and the reason the log header had to say `utc` out loud.
 * One control for one decision, at the end of the row it changes.
 *
 * The visible text is the zone in force and the accessible name is that same text plus what
 * pressing does — the arrangement the log rows already use, and the one that keeps WCAG's
 * label-in-name satisfied while still announcing an action three letters cannot. State rides on
 * `aria-pressed`, so nothing has to be inferred from the label changing.
 *
 * **Nothing here may move anything.** The cluster is `ml-auto`, packed against the right edge, so
 * every item in it sits at the mercy of the widths beside it and any change of size drags the range
 * buttons and the clock sideways. Two separate ways that could happen, both closed below: the
 * label changing width when pressed, and the control appearing at mount.
 */
export const ZoneToggle = () => {
  const { zone, abbrev, otherAbbrev, toggle } = useZone();

  /*
   * The zone is unknowable on the server — `localStorage` does not exist there and the runtime
   * resolves to `Etc/UTC` — so the first paint cannot name it. Rendered *invisible* rather than
   * absent, which is the same trade the clock beside it has always made: the box holds its place,
   * so the bar does not jump when the effect lands one frame later. Inert while it waits, by all
   * four means at once, because an invisible control that is still tabbable is a focus ring
   * landing on nothing.
   */
  const known = zone !== null && abbrev !== null && otherAbbrev !== null;

  return (
    <Button
      variant="quiet"
      onClick={known ? toggle : undefined}
      disabled={!known}
      aria-hidden={!known || undefined}
      tabIndex={known ? undefined : -1}
      aria-pressed={known ? zone === "utc" : undefined}
      title={known ? CHASSIS_TEXT.zoneHint : undefined}
      aria-label={known ? `${abbrev} · ${CHASSIS_TEXT.zoneSwitch(otherAbbrev)}` : undefined}
      className={cn("h-6 justify-center px-2 text-kicker tracking-control", !known && "invisible")}
    >
      {/*
       * Both labels stacked in one grid cell, so the button is always as wide as the wider of the
       * two strings it can ever show and pressing it changes nothing but the glyphs.
       *
       * Measuring the real strings beats a hardcoded `min-w-[4ch]`, which would be wrong twice
       * over: `ch` counts the font's advance and not `tracking-control`'s letter-spacing on top of
       * it, and a reader in a zone abbreviated `GMT+10` needs six. The floor is only what holds
       * the space open before either string is known.
       */}
      <span className="grid min-w-[5ch] justify-items-center">
        <span className="col-start-1 row-start-1">{abbrev ?? ""}</span>
        <span
          aria-hidden="true"
          className="invisible col-start-1 row-start-1"
        >
          {otherAbbrev ?? ""}
        </span>
      </span>
    </Button>
  );
};
