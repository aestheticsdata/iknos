import type { Device, UaFacts } from "./interfaces/traffic-types";

/**
 * Browser, system and device out of a user agent — major families only, no versions (spec §5.5).
 *
 * Hand-written rather than a dependency: the question is "how many readers are on phones", which
 * a dozen patterns answer, and the usual library (`ua-parser-js` v2) is AGPL.
 *
 * Order matters in both tables. Edge, Opera and Samsung Internet all carry `Chrome/` in their UA,
 * and Chrome carries `Safari/`, so the more specific name is tested first.
 */

export const DEVICE = { mobile: "mobile", tablet: "tablet", desktop: "desktop" } as const;

const OTHER = "Other";

type Family = { pattern: RegExp; name: string };

const BROWSERS: readonly Family[] = [
  { pattern: /Edg(e|A|iOS)?\//, name: "Edge" },
  { pattern: /OPR\/|Opera/, name: "Opera" },
  { pattern: /SamsungBrowser\//, name: "Samsung Internet" },
  { pattern: /Firefox\/|FxiOS\//, name: "Firefox" },
  { pattern: /Chrome\/|CriOS\//, name: "Chrome" },
  { pattern: /Safari\//, name: "Safari" },
];

const SYSTEMS: readonly Family[] = [
  { pattern: /iPad/, name: "iPadOS" },
  { pattern: /iPhone|iPod/, name: "iOS" },
  { pattern: /Android/, name: "Android" },
  { pattern: /CrOS/, name: "ChromeOS" },
  { pattern: /Windows/, name: "Windows" },
  { pattern: /Macintosh|Mac OS X/, name: "macOS" },
  { pattern: /Linux/, name: "Linux" },
];

const nameOf = (families: readonly Family[], ua: string) =>
  families.find((family) => family.pattern.test(ua))?.name ?? OTHER;

const deviceOf = (ua: string): Device => {
  if (/iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) return DEVICE.tablet;
  if (/Mobi|iPhone|iPod/.test(ua)) return DEVICE.mobile;
  return DEVICE.desktop;
};

export const parseUa = (ua: string): UaFacts => ({
  browser: nameOf(BROWSERS, ua),
  os: nameOf(SYSTEMS, ua),
  device: deviceOf(ua),
});
