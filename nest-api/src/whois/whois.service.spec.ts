import { WHOIS_REASON, WHOIS_STATUS } from "@contracts/whois";
import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { WHOIS_PREFIX, WHOIS_TTL_SECONDS, WhoisService } from "./whois.service";

import type { WhoisCache, WhoisFetch } from "./interfaces/whois-types";

const FOUND = JSON.stringify({
  success: true,
  country: "Germany",
  country_code: "DE",
  city: "Falkenstein",
  connection: { asn: 24940, org: "Hetzner Online GmbH", isp: "Hetzner Online GmbH", domain: "hetzner.com" },
});

type Rig = { service: WhoisService; calls: string[]; store: Map<string, string>; ttls: number[] };

type RigOptions = { answer?: () => Promise<{ status: number; body: string }>; cache?: WhoisCache; timeoutMs?: number };

/** A service whose every external call is counted — the ticket's acceptance is a call count. */
function rig({ answer, cache, timeoutMs }: RigOptions = {}): Rig {
  const calls: string[] = [];
  const store = new Map<string, string>();
  const ttls: number[] = [];

  const fetchImpl: WhoisFetch = async (url, { signal }) => {
    calls.push(url);
    if (!signal) throw new Error("every lookup must carry a timeout signal");
    // Honours the abort the way `fetch` does, so a slow answer is cut off rather than awaited.
    const aborted = new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason));
    });
    const { status, body } = await Promise.race([(answer ?? (async () => ({ status: 200, body: FOUND })))(), aborted]);
    return { status, text: async () => body };
  };

  const mapCache: WhoisCache = {
    get: async (key) => store.get(key) ?? null,
    set: async ({ key, value, ttlSeconds }) => {
      store.set(key, value);
      ttls.push(ttlSeconds);
    },
  };

  return { service: new WhoisService(cache ?? mapCache, fetchImpl, timeoutMs), calls, store, ttls };
}

describe("WhoisService", () => {
  it("asks the provider once, then serves the same address from cache", async () => {
    const { service, calls, ttls } = rig();

    const first = await service.lookup("203.0.113.9");
    const second = await service.lookup("203.0.113.9");

    expect(first).toMatchObject({ status: WHOIS_STATUS.found, asn: 24940, country: "Germany", cached: false });
    expect(second).toMatchObject({ status: WHOIS_STATUS.found, asn: 24940, cached: true });
    expect(calls).toEqual(["https://ipwho.is/203.0.113.9"]);
    expect(ttls).toEqual([WHOIS_TTL_SECONDS]);
  });

  it("shares one external call between concurrent clicks on one address", async () => {
    const { service, calls } = rig();

    const [a, b] = await Promise.all([service.lookup("203.0.113.9"), service.lookup("203.0.113.9")]);

    expect(calls).toHaveLength(1);
    expect(a.asn).toBe(24940);
    expect(b.asn).toBe(24940);
  });

  it("caches the mapped and the bare form of one address as one entry", async () => {
    const { service, calls, store } = rig();

    await service.lookup("::ffff:203.0.113.9");
    await service.lookup("203.0.113.9");

    expect(calls).toHaveLength(1);
    expect([...store.keys()]).toEqual([`${WHOIS_PREFIX}203.0.113.9`]);
  });

  it("answers a private address on the box, with no external call", async () => {
    const { service, calls } = rig();

    expect(await service.lookup("127.0.0.1")).toMatchObject({
      status: WHOIS_STATUS.unknown,
      reason: WHOIS_REASON.private,
    });
    expect(calls).toHaveLength(0);
  });

  it("refuses something that is not an address before anything is asked", async () => {
    const { service, calls } = rig();

    await expect(service.lookup("not-an-ip")).rejects.toBeInstanceOf(BadRequestException);
    expect(calls).toHaveLength(0);
  });

  it("caches the provider's refusal — it is a fact about the address", async () => {
    const { service, calls } = rig({
      answer: async () => ({ status: 200, body: JSON.stringify({ success: false, message: "Reserved range" }) }),
    });

    await service.lookup("192.0.2.1");
    const again = await service.lookup("192.0.2.1");

    expect(again).toMatchObject({ reason: WHOIS_REASON.refused, cached: true });
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["rate-limited", async () => ({ status: 429, body: "" })],
    ["down", async () => Promise.reject(new TypeError("fetch failed"))],
    ["answering nonsense", async () => ({ status: 200, body: "<html>bad gateway</html>" })],
  ])("is unavailable, and asks again next time, when the provider is %s", async (_, answer) => {
    const { service, calls, store } = rig({ answer });

    expect(await service.lookup("203.0.113.9")).toMatchObject({
      status: WHOIS_STATUS.unknown,
      reason: WHOIS_REASON.unavailable,
    });
    await service.lookup("203.0.113.9");

    expect(store.size).toBe(0);
    expect(calls).toHaveLength(2);
  });

  it("gives up on a slow provider within the timeout", async () => {
    const { service } = rig({
      timeoutMs: 20,
      answer: () => new Promise((resolve) => setTimeout(() => resolve({ status: 200, body: FOUND }), 200)),
    });

    const startedAt = performance.now();
    const answer = await service.lookup("203.0.113.9");

    expect(answer.reason).toBe(WHOIS_REASON.unavailable);
    expect(performance.now() - startedAt).toBeLessThan(150);
  });

  it("still answers when the cache is down", async () => {
    const broken: WhoisCache = {
      get: () => Promise.reject(new Error("The client is closed")),
      set: () => Promise.reject(new Error("The client is closed")),
    };
    const { service } = rig({ cache: broken });

    expect(await service.lookup("203.0.113.9")).toMatchObject({ status: WHOIS_STATUS.found, cached: false });
  });
});
