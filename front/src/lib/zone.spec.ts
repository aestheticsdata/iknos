import { describe, expect, it } from "vitest";
import {
  DEFAULT_ZONE,
  defaultZonedInput,
  fullInstant,
  parseZonedInstant,
  resolveZone,
  timeLabel,
  timeOfDay,
  zoneAbbrev,
} from "./zone";

/**
 * The offset is the whole point, so every case names its zone rather than trusting the machine's.
 *
 * August is CEST (+02:00) and January is CET (+01:00); a formatter built on a stored offset instead
 * of a named zone passes the first and fails the second, which is the bug this file exists to catch.
 */
const AUG = "2026-08-21T12:03:22.481Z";
const JAN = "2026-01-15T12:03:22.481Z";
const PARIS = "Europe/Paris";

describe("timeOfDay", () => {
  it("leaves a UTC instant exactly as the ISO string already spells it", () => {
    expect(timeOfDay(AUG, "UTC")).toBe("12:03:22.481");
  });

  it("keeps a UTC instant free of invented precision when the payload carried none", () => {
    expect(timeOfDay("2026-08-21T12:03:22Z", "UTC")).toBe("12:03:22");
  });

  /*
   * The API only ever emits `Z` — `toLogRow` calls `toISOString()` and the live tail builds the
   * same shape — so this is a guard on an assumption rather than a case anyone has seen. It is
   * worth pinning because the cheap path below reads the digits straight out of the string: given
   * an offset-bearing timestamp it would report the sender's wall clock as though it were UTC,
   * which is a wrong answer that looks exactly like a right one.
   */
  it("converts an offset-bearing timestamp instead of reading its digits as UTC", () => {
    expect(timeOfDay("2026-08-21T14:03:22.481+02:00", "UTC")).toBe("12:03:22.481");
  });

  it("adds two hours in Paris in August", () => {
    expect(timeOfDay(AUG, PARIS)).toBe("14:03:22.481");
  });

  it("adds one hour in Paris in January", () => {
    expect(timeOfDay(JAN, PARIS)).toBe("13:03:22.481");
  });

  it("drops the milliseconds in a named zone too when the payload had none", () => {
    expect(timeOfDay("2026-08-21T12:03:22Z", PARIS)).toBe("14:03:22");
  });

  it("rolls past midnight into the next day", () => {
    expect(timeOfDay("2026-08-21T23:30:00.000Z", PARIS)).toBe("01:30:00.000");
  });

  it("reads midnight as 00, never as 24", () => {
    expect(timeOfDay("2026-08-21T22:00:00.000Z", PARIS)).toBe("00:00:00.000");
  });

  it("returns an unparseable timestamp untouched rather than throwing", () => {
    expect(timeOfDay("not-a-timestamp", PARIS)).toBe("not-a-timestamp");
  });
});

describe("timeLabel", () => {
  it("shows seconds under a minute-wide bucket", () => {
    expect(timeLabel(Date.parse(AUG), 1_000, "UTC")).toBe("12:03:22");
  });

  it("shows hours and minutes under a day-wide bucket", () => {
    expect(timeLabel(Date.parse(AUG), 60_000, "UTC")).toBe("12:03");
  });

  it("shows month and day at a day-wide bucket or wider", () => {
    expect(timeLabel(Date.parse(AUG), 86_400_000, "UTC")).toBe("08-21");
  });

  it("shifts the hour label into the reader's zone", () => {
    expect(timeLabel(Date.parse(AUG), 60_000, PARIS)).toBe("14:03");
  });

  it("shifts the date label when the zone crosses a day boundary", () => {
    expect(timeLabel(Date.parse("2026-08-21T23:30:00Z"), 86_400_000, PARIS)).toBe("08-22");
  });

  it("draws nothing for a bucket whose timestamp will not parse", () => {
    expect(timeLabel(Number.NaN, 60_000, PARIS)).toBe("");
  });
});

describe("zoneAbbrev", () => {
  it("names the summer offset in force", () => {
    expect(zoneAbbrev(PARIS, new Date(AUG))).toBe("CEST");
  });

  it("names the winter offset in force", () => {
    expect(zoneAbbrev(PARIS, new Date(JAN))).toBe("CET");
  });

  it("names UTC as itself", () => {
    expect(zoneAbbrev("UTC", new Date(AUG))).toBe("UTC");
  });
});

describe("fullInstant", () => {
  it("hands back the raw ISO string in UTC, which is what the API and the URL speak", () => {
    expect(fullInstant(AUG, "UTC")).toBe(AUG);
  });

  it("carries the date and the offset in a named zone, since the column alone shows neither", () => {
    expect(fullInstant("2026-08-21T23:30:00.000Z", PARIS)).toBe("2026-08-22 01:30:00.000 CEST");
  });

  it("returns an unparseable timestamp untouched", () => {
    expect(fullInstant("nonsense", PARIS)).toBe("nonsense");
  });
});

describe("parseZonedInstant", () => {
  it("reads a UTC value as UTC digits, no offset applied", () => {
    expect(parseZonedInstant("2026-08-21T12:03:22", "UTC")?.toISOString()).toBe("2026-08-21T12:03:22.000Z");
  });

  it("subtracts two hours for a Paris value in August (CEST)", () => {
    expect(parseZonedInstant("2026-08-21T14:03:22", PARIS)?.toISOString()).toBe("2026-08-21T12:03:22.000Z");
  });

  it("subtracts one hour for a Paris value in January (CET) — the same field, a different offset", () => {
    expect(parseZonedInstant("2026-01-15T13:03:22", PARIS)?.toISOString()).toBe("2026-01-15T12:03:22.000Z");
  });

  it("defaults to :00 seconds when the field only carries hours and minutes", () => {
    expect(parseZonedInstant("2026-08-21T14:03", PARIS)?.toISOString()).toBe("2026-08-21T12:03:00.000Z");
  });

  it("returns null rather than a wrong instant for a value that will not parse", () => {
    expect(parseZonedInstant("not-a-datetime", PARIS)).toBeNull();
  });

  it("round-trips defaultZonedInput's own output, in the zone it was built for", () => {
    // Truncated to the second: a `datetime-local` field has no millisecond digit to carry one in.
    const at = new Date("2026-08-21T12:03:22.000Z");
    expect(parseZonedInstant(defaultZonedInput(PARIS, at), PARIS)).toEqual(at);
  });
});

describe("defaultZonedInput", () => {
  it("names the wall clock in UTC as a bare datetime-local value", () => {
    expect(defaultZonedInput("UTC", new Date(AUG))).toBe("2026-08-21T12:03:22");
  });

  it("shifts the same instant two hours ahead in Paris in August", () => {
    expect(defaultZonedInput(PARIS, new Date(AUG))).toBe("2026-08-21T14:03:22");
  });
});

describe("resolveZone", () => {
  it("maps the utc choice to UTC without consulting the runtime", () => {
    expect(resolveZone("utc")).toBe("UTC");
  });

  it("maps the local choice to whatever zone the runtime is in", () => {
    expect(resolveZone("local")).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it("defaults to the reader's own zone", () => {
    expect(DEFAULT_ZONE).toBe("local");
  });
});
