import { describe, expect, it } from "vitest";
import { MAX_SCRAPE_BYTES, scrapeTarget } from "./scrape-target";

import type { FetchLike } from "./scrape-target";

/**
 * The scrape itself (IKN-8): stream the body through a LineBuffer, parse line by line, never
 * hold a multi-megabyte string. The fetch is injected, so these tests exercise chunk
 * reassembly, the byte cap and the failure modes without a network.
 */
const stream = (chunks: string[]): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
      controller.close();
    },
  });

const respond = (status: number, chunks: string[]): ReturnType<FetchLike> =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, body: stream(chunks) });

describe("scrapeTarget", () => {
  it("parses samples from a body split mid-line across chunks", async () => {
    const fetchImpl: FetchLike = () =>
      respond(200, ['# TYPE a counter\na{method="G', 'ET"} 1\nb 2.5\n', "# a trailing comment\n"]);

    const result = await scrapeTarget("http://x/metrics", fetchImpl);

    expect(result.samples).toEqual([
      { name: "a", labels: { method: "GET" }, value: 1 },
      { name: "b", labels: null, value: 2.5 },
    ]);
  });

  it("parses a final line that arrives without a trailing newline", async () => {
    const fetchImpl: FetchLike = () => respond(200, ["last_line 42"]);

    const result = await scrapeTarget("http://x/metrics", fetchImpl);

    expect(result.samples).toEqual([{ name: "last_line", labels: null, value: 42 }]);
  });

  it("reports the bytes it read", async () => {
    const fetchImpl: FetchLike = () => respond(200, ["ab 1\n"]);

    expect((await scrapeTarget("http://x/metrics", fetchImpl)).bytes).toBe(5);
  });

  it("throws on a non-2xx response — an error page is not an empty scrape", async () => {
    const fetchImpl: FetchLike = () => respond(502, ["<html>Bad Gateway</html>\n"]);

    await expect(scrapeTarget("http://x/metrics", fetchImpl)).rejects.toThrow("502");
  });

  it("throws once the body exceeds the byte cap instead of buffering it", async () => {
    const big = `${"x".repeat(1024)}\n`;
    const chunks = Array.from({ length: MAX_SCRAPE_BYTES / big.length + 2 }, () => big);
    const fetchImpl: FetchLike = () => respond(200, chunks);

    await expect(scrapeTarget("http://x/metrics", fetchImpl)).rejects.toThrow(/exceeds/);
  });

  it("propagates a network failure for the caller to record", async () => {
    const fetchImpl: FetchLike = () => Promise.reject(new Error("connect ECONNREFUSED"));

    await expect(scrapeTarget("http://x/metrics", fetchImpl)).rejects.toThrow("ECONNREFUSED");
  });
});
