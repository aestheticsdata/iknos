import { describe, expect, it } from "vitest";
import { probeHealth } from "./probe-health";

import type { ProbeFetch } from "./probe-health";

/**
 * The health probe (IKN-8): a failed probe is never an exception, it is the row. The one
 * invariant that earns its own tests: the per-dependency breakdown survives a 503 — a degraded
 * body is exactly when the `mysql`/`redis` pills matter most.
 */
describe("probeHealth", () => {
  const stream = (chunks: string[]): ReadableStream<Uint8Array> =>
    new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
        controller.close();
      },
    });

  const respond = (status: number, body: unknown): ReturnType<ProbeFetch> =>
    Promise.resolve({
      status,
      body: stream([typeof body === "string" ? body : JSON.stringify(body)]),
    });

  it("records a healthy probe with status, latency and the per-dependency checks", async () => {
    const fetchImpl: ProbeFetch = () =>
      respond(200, {
        status: "ok",
        version: "0.0.1",
        checks: { db: { status: "ok", latencyMs: 3 }, redis: { status: "ok", latencyMs: 1 } },
      });

    const outcome = await probeHealth("http://x/health", fetchImpl);

    expect(outcome.httpStatus).toBe(200);
    expect(outcome.ok).toBe(true);
    expect(outcome.latencyMs).toBeGreaterThanOrEqual(0);
    expect(outcome.error).toBeNull();
    expect(outcome.checks).toEqual({ db: { status: "ok", latencyMs: 3 }, redis: { status: "ok", latencyMs: 1 } });
    expect(outcome.version).toBe("0.0.1");
  });

  it("keeps the checks breakdown on a 503 — degraded is when the pills matter", async () => {
    const fetchImpl: ProbeFetch = () =>
      respond(503, {
        status: "degraded",
        checks: { db: { status: "ok", latencyMs: 2 }, redis: { status: "error", latencyMs: 1001 } },
      });

    const outcome = await probeHealth("http://x/health", fetchImpl);

    expect(outcome.ok).toBe(false);
    expect(outcome.httpStatus).toBe(503);
    expect(outcome.checks).toMatchObject({ redis: { status: "error" } });
    expect(outcome.error).toBeNull();
  });

  it("tolerates a non-JSON body — the status code is still a fact", async () => {
    const fetchImpl: ProbeFetch = () => respond(200, "<html>ok</html>");

    const outcome = await probeHealth("http://x/health", fetchImpl);

    expect(outcome.httpStatus).toBe(200);
    expect(outcome.ok).toBe(true);
    expect(outcome.checks).toBeNull();
    expect(outcome.version).toBeNull();
  });

  it("records an unreachable service as data, never a throw", async () => {
    const fetchImpl: ProbeFetch = () => Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:6100"));

    const outcome = await probeHealth("http://x/health", fetchImpl);

    expect(outcome.httpStatus).toBeNull();
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("ECONNREFUSED");
    expect(outcome.checks).toBeNull();
  });

  it("clamps the recorded error to the column width", async () => {
    const fetchImpl: ProbeFetch = () => Promise.reject(new Error("x".repeat(400)));

    const outcome = await probeHealth("http://x/health", fetchImpl);

    expect(outcome.error).toHaveLength(255);
  });

  it("clamps the reported version to its column — one verbose endpoint must not sink the whole batch", async () => {
    const fetchImpl: ProbeFetch = () => respond(200, { status: "ok", version: "v".repeat(200) });

    const outcome = await probeHealth("http://x/health", fetchImpl);

    expect(outcome.version).toHaveLength(64);
  });

  it("stops reading an oversized body at the cap instead of buffering it whole", async () => {
    // A misconfigured healthUrl pointing at something big: the probe must bound its own memory
    // the way the scrape path does, not rely on the timeout to cut the flood short.
    const chunk = "x".repeat(16 * 1024);
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 1000) throw new Error("the reader never stopped");
        controller.enqueue(new TextEncoder().encode(chunk));
      },
    });
    const fetchImpl: ProbeFetch = () => Promise.resolve({ status: 200, body });

    const outcome = await probeHealth("http://x/health", fetchImpl);

    expect(outcome.httpStatus).toBe(200);
    expect(outcome.checks).toBeNull();
    expect(pulls).toBeLessThan(10);
  });
});
