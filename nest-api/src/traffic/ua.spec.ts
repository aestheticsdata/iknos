import { describe, expect, it } from "vitest";
import { DEVICE, parseUa } from "./ua";

describe("parseUa", () => {
  it("reads an iPhone", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
    expect(parseUa(ua)).toEqual({ browser: "Safari", os: "iOS", device: DEVICE.mobile });
  });

  it("reads Chrome on Windows", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
    expect(parseUa(ua)).toEqual({ browser: "Chrome", os: "Windows", device: DEVICE.desktop });
  });

  it("reads Firefox on an Android phone", () => {
    const ua = "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0";
    expect(parseUa(ua)).toEqual({ browser: "Firefox", os: "Android", device: DEVICE.mobile });
  });

  it("reads an iPad as a tablet", () => {
    const ua =
      "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
    expect(parseUa(ua)).toEqual({ browser: "Safari", os: "iPadOS", device: DEVICE.tablet });
  });

  it("tells Edge from the Chrome it is built on", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";
    expect(parseUa(ua).browser).toBe("Edge");
  });

  it("names Samsung Internet", () => {
    const ua =
      "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36";
    expect(parseUa(ua)).toEqual({ browser: "Samsung Internet", os: "Android", device: DEVICE.mobile });
  });

  it("reads Safari on a Mac", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
    expect(parseUa(ua)).toEqual({ browser: "Safari", os: "macOS", device: DEVICE.desktop });
  });

  it("falls back to other for anything unrecognised", () => {
    expect(parseUa("something")).toEqual({ browser: "Other", os: "Other", device: DEVICE.desktop });
  });
});
