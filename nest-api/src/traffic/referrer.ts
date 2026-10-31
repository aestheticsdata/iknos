import type { Campaign } from "./interfaces/traffic-types";

/**
 * Where a visit came from — the referrer, read as a source rather than a URL (spec §5.4).
 *
 * The raw referrer is a full URL with whatever path the other site had; the reader's question is
 * "did Hacker News send anyone", so hosts are folded into names through one table, and anything
 * the table does not know is shown as its bare host.
 */

export const DIRECT_SOURCE = "Direct or unknown";

/** `null` for an absent, dashed or unparsable referrer, and for app schemes (`android-app://`). */
export const refererHost = (referrer: string | null): string | null => {
  if (referrer === null || referrer === "" || referrer === "-") return null;

  try {
    const url = new URL(referrer);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    /* A bare address or localhost is no source anyone can act on, and it can be the reader's own
       network — so it is folded into "Direct or unknown" rather than shown (spec §3). */
    if (host === "localhost" || host.startsWith("[") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
    return host;
  } catch {
    return null;
  }
};

/** Ordered; the first match names the source. Patterns are tested against the bare host. */
const SOURCES: readonly { pattern: RegExp; name: string }[] = [
  { pattern: /(^|\.)google\.[a-z.]+$/, name: "Google" },
  { pattern: /(^|\.)bing\.com$/, name: "Bing" },
  { pattern: /(^|\.)duckduckgo\.com$/, name: "DuckDuckGo" },
  { pattern: /(^|\.)qwant\.com$/, name: "Qwant" },
  { pattern: /(^|\.)ecosia\.org$/, name: "Ecosia" },
  { pattern: /(^|\.)yandex\.[a-z.]+$/, name: "Yandex" },
  { pattern: /(^|\.)search\.brave\.com$/, name: "Brave Search" },
  { pattern: /(^|\.)(chatgpt\.com|chat\.openai\.com)$/, name: "ChatGPT" },
  { pattern: /(^|\.)claude\.ai$/, name: "Claude" },
  { pattern: /(^|\.)perplexity\.ai$/, name: "Perplexity" },
  { pattern: /^(t\.co|x\.com|twitter\.com|mobile\.twitter\.com)$/, name: "X" },
  { pattern: /(^|\.)(linkedin\.com|lnkd\.in)$/, name: "LinkedIn" },
  { pattern: /^news\.ycombinator\.com$/, name: "Hacker News" },
  { pattern: /(^|\.)reddit\.com$/, name: "Reddit" },
  { pattern: /(^|\.)github\.com$/, name: "GitHub" },
  { pattern: /(^|\.)(facebook\.com|fb\.com)$/, name: "Facebook" },
  { pattern: /(^|\.)instagram\.com$/, name: "Instagram" },
  { pattern: /(^|\.)bsky\.app$/, name: "Bluesky" },
  {
    pattern: /(^|\.)(mastodon\.[a-z]+|mastodon\.social|mstdn\.[a-z]+|fosstodon\.org|hachyderm\.io)$/,
    name: "Mastodon",
  },
  { pattern: /(^|\.)youtube\.com$/, name: "YouTube" },
  { pattern: /(^|\.)lobste\.rs$/, name: "Lobsters" },
  { pattern: /(^|\.)producthunt\.com$/, name: "Product Hunt" },
];

export const sourceName = (host: string | null): string => {
  if (host === null) return DIRECT_SOURCE;
  return SOURCES.find((source) => source.pattern.test(host))?.name ?? host;
};

/** The `utm_` triple, or `ref=` standing in for `utm_source`. `null` when neither is there. */
export const campaignOf = (query: string | null): Campaign | null => {
  if (query === null || query === "") return null;

  const params = new URLSearchParams(query);
  const source = params.get("utm_source") || params.get("ref");
  if (!source) return null;

  return { source, medium: params.get("utm_medium") || null, campaign: params.get("utm_campaign") || null };
};
