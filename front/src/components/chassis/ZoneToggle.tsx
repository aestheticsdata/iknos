"use client";

import { Button } from "@components/ui/Button";
import { useZone } from "@lib/zoneState";
import { CHASSIS_TEXT } from "@text/chassis";

/**
 * Which clock the panel is read on — IKN-38.
 *
 * It sits beside the chassis clock rather than in the log panel's own bar, because the zone
 * governs both: the clock in this bar was the app's only local-time render and the reason the log
 * header had to say `utc` out loud. One control for one decision, next to the thing it visibly
 * changes.
 *
 * The visible text is the zone in force and the accessible name is that same text plus what
 * pressing does — the arrangement the log rows already use, and the one that keeps WCAG's
 * label-in-name satisfied while still announcing an action the three letters cannot. State rides
 * on `aria-pressed`, so nothing has to be inferred from the label changing.
 *
 * Absent, not disabled, until the zone is known. It is unknowable on the server, and a control
 * rendered dead for one frame on every page load is the "grisée à venir" the design doc rules out.
 */
export const ZoneToggle = () => {
  const { zone, abbrev, otherAbbrev, toggle } = useZone();

  if (zone === null || abbrev === null || otherAbbrev === null) return null;

  return (
    <Button
      variant="quiet"
      onClick={toggle}
      aria-pressed={zone === "utc"}
      title={CHASSIS_TEXT.zoneHint}
      aria-label={`${abbrev} · ${CHASSIS_TEXT.zoneSwitch(otherAbbrev)}`}
      className="h-6 px-2 text-kicker tracking-control"
    >
      {abbrev}
    </Button>
  );
};
