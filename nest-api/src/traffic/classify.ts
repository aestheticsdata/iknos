import type { BotIdentity, Kind, KindInput } from "./interfaces/traffic-types";

/**
 * What one access-log request was — the two questions the traffic view asks of every row (IKN-83).
 *
 * **Who** sent it: a person, a crawler, or a scanner probing for a WordPress that is not there.
 * **What** it fetched: a page someone reads, a file that page pulled in, or neither (an RSC fetch,
 * an API call, a POST). A page view is the intersection a reader means by "a visit": a human
 * fetching a page. Everything else is counted, but never as that.
 *
 * Pure and Nest-free, like `nginx-parser.ts`: these tables are what decides every number on the
 * page, so they are tested line by line.
 */

export const AUDIENCE = { human: "human", bot: "bot", scanner: "scanner" } as const;

export const KIND = { page: "page", asset: "asset", other: "other" } as const;

/**
 * Paths nobody asks a static site or a Next app for except someone scanning for a known hole.
 *
 * One hit on any of these marks the address as a scanner for the day (spec §5.2), so the list is
 * deliberately narrow: a false positive here would hide a real reader's whole day.
 */
const PROBE_PATTERNS: readonly RegExp[] = [
  /\/wp-(login|admin|content|includes)/i,
  /\/xmlrpc\.php/i,
  /\/\.env/i,
  /\/\.git(\/|$)/i,
  /phpmyadmin/i,
  /\/cgi-bin\//i,
  /\.php$/i,
  /\/vendor\/phpunit/i,
  /\/actuator(\/|$)/i,
  /\/boaform/i,
  /\/\.aws/i,
  /\/(HNAP1|GponForm|setup\.cgi)/i,
];

export const isProbePath = (route: string): boolean => PROBE_PATTERNS.some((pattern) => pattern.test(route));

/**
 * Ordered: previews and named crawlers before the generic `bot|crawl|spider` catch-all, or every
 * one of them would be "Other bots".
 *
 * A **preview** is the fetch a chat app or a social network makes when someone pastes a link. It
 * is a bot, and it is also the only trace a share leaves in an access log — hence its own flag.
 */
const BOT_PATTERNS: readonly (BotIdentity & { pattern: RegExp })[] = [
  { pattern: /Slackbot/i, name: "Slack preview", preview: true },
  { pattern: /LinkedInBot/i, name: "LinkedIn preview", preview: true },
  { pattern: /Twitterbot/i, name: "X preview", preview: true },
  { pattern: /facebookexternalhit|Facebot|meta-externalagent/i, name: "Facebook preview", preview: true },
  { pattern: /Discordbot/i, name: "Discord preview", preview: true },
  { pattern: /WhatsApp/i, name: "WhatsApp preview", preview: true },
  { pattern: /TelegramBot/i, name: "Telegram preview", preview: true },
  { pattern: /Mastodon/i, name: "Mastodon preview", preview: true },
  { pattern: /Bluesky|Cardyb/i, name: "Bluesky preview", preview: true },
  { pattern: /Googlebot|Google-InspectionTool|GoogleOther/i, name: "Googlebot", preview: false },
  { pattern: /bingbot|BingPreview/i, name: "Bingbot", preview: false },
  { pattern: /Applebot/i, name: "Applebot", preview: false },
  { pattern: /DuckDuckBot/i, name: "DuckDuckBot", preview: false },
  { pattern: /YandexBot/i, name: "YandexBot", preview: false },
  { pattern: /Baiduspider/i, name: "Baiduspider", preview: false },
  { pattern: /GPTBot|ChatGPT-User|OAI-SearchBot/i, name: "GPTBot", preview: false },
  { pattern: /ClaudeBot|Claude-User|Claude-SearchBot|anthropic-ai/i, name: "ClaudeBot", preview: false },
  { pattern: /PerplexityBot|Perplexity-User/i, name: "PerplexityBot", preview: false },
  { pattern: /CCBot/i, name: "CCBot", preview: false },
  { pattern: /Bytespider/i, name: "Bytespider", preview: false },
  { pattern: /AhrefsBot/i, name: "AhrefsBot", preview: false },
  { pattern: /SemrushBot/i, name: "SemrushBot", preview: false },
  { pattern: /MJ12bot/i, name: "MJ12bot", preview: false },
  { pattern: /DotBot/i, name: "DotBot", preview: false },
  { pattern: /PetalBot/i, name: "PetalBot", preview: false },
  { pattern: /^curl\//i, name: "curl", preview: false },
  { pattern: /^Wget\//i, name: "Wget", preview: false },
  { pattern: /python-requests|python-urllib|aiohttp|httpx/i, name: "Python client", preview: false },
  { pattern: /Go-http-client/i, name: "Go client", preview: false },
  { pattern: /axios|node-fetch|undici/i, name: "Node client", preview: false },
  { pattern: /HeadlessChrome|PhantomJS|Puppeteer|Playwright/i, name: "Headless browser", preview: false },
  { pattern: /UptimeRobot|Pingdom|StatusCake|Better Uptime/i, name: "Uptime monitor", preview: false },
  { pattern: /bot|crawl|spider|slurp|scan|fetch|preview|scrap/i, name: "Other bots", preview: false },
];

export const UNKNOWN_CLIENT = "Unknown client";

/** `null` for a browser. A missing user agent is never a person's browser, so it is a bot too. */
export const botName = (ua: string): BotIdentity | null => {
  if (ua === "" || ua === "-") return { name: UNKNOWN_CLIENT, preview: false };

  const match = BOT_PATTERNS.find((bot) => bot.pattern.test(ua));
  return match ? { name: match.name, preview: match.preview } : null;
};

/** Build output and API prefixes — never a document, whatever their path looks like. */
const NON_PAGE_PREFIXES: readonly string[] = ["/_next/", "/api/", "/static/", "/assets/"];

const PAGE_EXTENSIONS = /\.html?$/i;
const ANY_EXTENSION = /\.[a-z0-9]{1,8}$/i;

export const requestKind = ({ method, route, query }: KindInput): Kind => {
  if (route === null) return KIND.other;

  if (route.startsWith("/_next/") || (ANY_EXTENSION.test(route) && !PAGE_EXTENSIONS.test(route))) return KIND.asset;
  if (method !== "GET") return KIND.other;
  if (NON_PAGE_PREFIXES.some((prefix) => route.startsWith(prefix))) return KIND.other;
  /* A Next.js client navigation or a link prefetch. The two cannot be told apart in an access log,
     so neither is a page view (spec §2). */
  if (query !== null && /(^|&)_rsc=/.test(query)) return KIND.other;

  return KIND.page;
};
