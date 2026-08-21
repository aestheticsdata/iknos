import { describe, expect, it } from "vitest";
import { formatBytes, formatCount, formatLag } from "./format";

describe("formatBytes", () => {
  it("keeps small numbers whole", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
  });

  it("climbs the SI ladder, one decimal where it helps", () => {
    expect(formatBytes(4_200_000_000)).toBe("4.2 GB");
    expect(formatBytes(812_000_000)).toBe("812 MB");
    expect(formatBytes(1500)).toBe("1.5 kB");
  });

  it("drops the decimal once the number is big enough not to need it", () => {
    expect(formatBytes(123_400_000)).toBe("123 MB");
  });

  it("drops a trailing zero rather than printing 4.0 GB", () => {
    expect(formatBytes(4_000_000_000)).toBe("4 GB");
  });

  it("says nothing rather than something wrong for a number that is not one", () => {
    expect(formatBytes(Number.NaN)).toBe("—");
    expect(formatBytes(-1)).toBe("—");
  });
});

describe("formatCount", () => {
  it("groups in threes, the way the mockup does", () => {
    expect(formatCount(10_464)).toBe("10 464");
    expect(formatCount(1_234_567)).toBe("1 234 567");
  });

  it("leaves three digits and fewer alone", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
  });
});

describe("formatLag", () => {
  it("uses the unit the reader can act on", () => {
    expect(formatLag(120)).toBe("120ms");
    expect(formatLag(400)).toBe("400ms");
    expect(formatLag(1_400)).toBe("1.4s");
    expect(formatLag(90_000)).toBe("2m");
    expect(formatLag(7_200_000)).toBe("2h");
  });

  it("refuses to render a negative lag as a number", () => {
    expect(formatLag(-5)).toBe("—");
  });
});
