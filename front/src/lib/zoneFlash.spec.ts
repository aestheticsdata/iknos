import { describe, expect, it } from "vitest";
import { zoneFlashClass } from "./zoneFlash";

describe("zoneFlashClass", () => {
  it("gives nothing before the toggle has ever been pressed", () => {
    // The mount case. The zone is settled from `localStorage` at `pulse: 0`, and the page must not
    // announce a decision the reader did not make.
    expect(zoneFlashClass(0)).toBeNull();
  });

  it("gives a class on every press", () => {
    for (let pulse = 1; pulse <= 8; pulse++) expect(zoneFlashClass(pulse)).not.toBeNull();
  });

  it("never hands back the same class twice running", () => {
    // The replay guarantee, and the reason there are two keyframes rather than one: a CSS
    // animation restarts only when its name changes. If two consecutive presses ever returned the
    // same class the second press would be silent.
    for (let pulse = 1; pulse <= 20; pulse++) {
      expect(zoneFlashClass(pulse)).not.toBe(zoneFlashClass(pulse + 1));
    }
  });

  it("alternates between exactly the two names the theme declares", () => {
    expect(zoneFlashClass(1)).toBe("animate-zone-flash-a");
    expect(zoneFlashClass(2)).toBe("animate-zone-flash-b");
    expect(zoneFlashClass(3)).toBe("animate-zone-flash-a");
  });

  it("treats a count that ran backwards as no press at all", () => {
    // Not reachable through `ZoneProvider`, which only ever increments. Pinned so that if it ever
    // becomes reachable the answer is "no flash" rather than a class chosen by a negative modulo.
    expect(zoneFlashClass(-1)).toBeNull();
    expect(zoneFlashClass(-2)).toBeNull();
  });
});
