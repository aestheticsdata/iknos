import { LineBuffer } from "@ingest/line-buffer";
import { type PromSample, parsePromLine } from "./prometheus-parser";

/** Five seconds: a metrics endpoint on localhost that takes longer is a fact worth failing on. */
export const SCRAPE_TIMEOUT_MS = 5000;

/** A /metrics body past this is a cardinality accident; buffering it would be a second one. */
export const MAX_SCRAPE_BYTES = 4 * 1024 * 1024;

/** The slice of `fetch` the scraper uses — injectable, so tests never open a socket. */
export type FetchLike = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; body: ReadableStream<Uint8Array> | null }>;

export type ScrapeResult = { samples: PromSample[]; bytes: number };

/**
 * One scrape of one target (IKN-8): stream the body through a LineBuffer and parse line by
 * line — the multi-megabyte `split` this avoids would run on the event loop the API shares.
 *
 * Throws on anything that is not a clean scrape — non-2xx, missing body, byte cap, network
 * failure, timeout. The caller records the failure; recording is its job, aborting cleanly is
 * this function's.
 */
export async function scrapeTarget(
  url: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs: number = SCRAPE_TIMEOUT_MS,
): Promise<ScrapeResult> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`scrape got HTTP ${response.status}`);
  if (!response.body) throw new Error("scrape got no body");

  const buffer = new LineBuffer();
  const samples: PromSample[] = [];
  let bytes = 0;

  const drain = () => {
    for (let line = buffer.nextLine(); line !== null; line = buffer.nextLine()) {
      const sample = parsePromLine(line);
      if (sample) samples.push(sample);
    }
  };

  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > MAX_SCRAPE_BYTES) throw new Error(`scrape body exceeds ${MAX_SCRAPE_BYTES} bytes`);
    buffer.push(Buffer.from(chunk));
    drain();
  }

  // A final line without a trailing newline is still a line; the LF forces it out.
  if (buffer.pendingBytes > 0) {
    buffer.push(Buffer.from("\n"));
    drain();
  }

  return { samples, bytes };
}
