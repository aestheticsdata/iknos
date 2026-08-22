/** Three seconds: a health endpoint slower than this is answering a different question. */
export const PROBE_TIMEOUT_MS = 3000;

/** The slice of `fetch` the probe uses — injectable, so tests never open a socket. */
export type ProbeFetch = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<{ status: number; body: ReadableStream<Uint8Array> | null }>;

/** One `health_check` row, minus id and ts. */
export type ProbeOutcome = {
  httpStatus: number | null;
  ok: boolean;
  latencyMs: number;
  error: string | null;
  checks: Record<string, unknown> | null;
  version: string | null;
};

const MAX_ERROR_LENGTH = 255;
const MAX_VERSION_LENGTH = 64;
const MAX_BODY_BYTES = 64 * 1024;

/**
 * One probe of one health endpoint (IKN-8). Never throws: an unreachable service, a timeout, a
 * body of HTML — each is the row, not an exception.
 *
 * The per-dependency `checks` object is kept whole even on a 503 — a degraded body is exactly
 * when the `mysql`/`redis` pills matter, and IKN-2 keeps sending it.
 */
export async function probeHealth(
  url: string,
  fetchImpl: ProbeFetch = fetch,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<ProbeOutcome> {
  const start = process.hrtime.bigint();
  const latencyMs = () => Math.round(Number(process.hrtime.bigint() - start) / 1e6);

  let response: Awaited<ReturnType<ProbeFetch>>;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      httpStatus: null,
      ok: false,
      latencyMs: latencyMs(),
      error: message.slice(0, MAX_ERROR_LENGTH),
      checks: null,
      version: null,
    };
  }

  const body = await bodyOf(response);
  return {
    httpStatus: response.status,
    ok: response.status >= 200 && response.status < 300,
    latencyMs: latencyMs(),
    error: null,
    checks: isRecord(body?.checks) ? body.checks : null,
    // Clamped like `error`: one endpoint reporting a verbose version must not sink the whole
    // health batch on the column width.
    version: typeof body?.version === "string" ? body.version.slice(0, MAX_VERSION_LENGTH) : null,
  };
}

/**
 * The body, read through its stream with the byte cap enforced **while reading** — the same
 * discipline as the scrape path. Checking a cap after `text()` would bound parsing but not
 * memory, and a misconfigured `healthUrl` pointing at something large is exactly the accident
 * this guards against. Past the cap the body is abandoned: null, a data absence.
 */
async function bodyOf(
  response: Awaited<ReturnType<ProbeFetch>>,
): Promise<{ checks?: unknown; version?: unknown } | null> {
  if (!response.body) return null;
  try {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > MAX_BODY_BYTES) return null;
      chunks.push(Buffer.from(chunk));
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
