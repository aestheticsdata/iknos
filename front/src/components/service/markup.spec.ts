import { ServiceHeader } from "@components/service/ServiceHeader";
import { Signals } from "@components/service/Signals";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ProcessFacts, ServiceRuntime, ServiceSignals } from "@lib/serviceTypes";

/**
 * The service view's markup, rendered to a string — IKN-13.
 *
 * The front's runner covers pure functions and says in as many words that components are not
 * covered, "pretending otherwise with a jsdom environment would only invite it". These are not
 * that: `renderToStaticMarkup` needs no DOM, no environment and no act(), and what it checks is
 * half of this ticket's Done list — the release chip that must keep its place, the restarts chip
 * that turns red, the pool bar that reaches red at saturation, the unscraped service that gets a
 * sentence instead of four empty boxes.
 *
 * Every one of those is a rule about *what is rendered*, and every one of them would otherwise be
 * verified by a person opening a browser and remembering to look. Nothing here asserts a layout,
 * a pixel or an interaction — those still need the browser, and they always will.
 */

const PROCESS: ProcessFacts = {
  pm2Id: 3,
  status: "online",
  restarts: 0,
  nodeVersion: "24.19.0",
  startedAt: "2026-08-17T08:00:00Z",
  observedAt: "2026-08-23T12:00:00Z",
};

const runtime = (over: Partial<ServiceRuntime> = {}): ServiceRuntime => ({
  service: "pfa-nest-api",
  pm2Name: "pfa-nest-api",
  scraped: true,
  probed: true,
  release: null,
  process: PROCESS,
  probe: {
    status: "ok",
    httpStatus: 200,
    latencyMs: 5,
    error: null,
    checkedAt: "2026-08-23T11:59:40Z",
    checks: [
      { name: "db", status: "ok", latencyMs: 1 },
      { name: "redis", status: "ok", latencyMs: 1 },
    ],
  },
  runtime: {
    heapUsedBytes: 94_572_784,
    heapTotalBytes: 214_220_800,
    eventLoopLagMs: 11.37,
    pool: { active: 0, idle: 10, waiting: 0 },
    observedAt: "2026-08-23T11:59:55Z",
  },
  observedAt: "2026-08-23T12:00:00Z",
  meta: { tookMs: 4 },
  ...over,
});

const signals = (over: Partial<ServiceSignals> = {}): ServiceSignals => ({
  service: "pfa-nest-api",
  from: "2026-08-23T11:00:00Z",
  to: "2026-08-23T12:00:00Z",
  bucketMs: 60_000,
  source: "raw",
  scraped: true,
  throughput: {
    value: 0.4,
    points: [
      { t: "a", v: 0.3 },
      { t: "b", v: null },
      { t: "c", v: 0.5 },
    ],
  },
  errorRate: {
    value: 0,
    points: [
      { t: "a", v: 0 },
      { t: "b", v: null },
      { t: "c", v: 0 },
    ],
  },
  p95: {
    value: 9.5,
    points: [
      { t: "a", v: 9 },
      { t: "b", v: null },
      { t: "c", v: 10 },
    ],
  },
  meta: { tookMs: 12 },
  ...over,
});

const header = (over?: Partial<ServiceRuntime>, signalsOpen = true) =>
  renderToStaticMarkup(
    h(ServiceHeader, { runtime: runtime(over), range: "1h", signalsOpen, onToggleSignals: () => {} }),
  );

describe("service header", () => {
  it("keeps the release chip with an em dash when no deploy has written a marker", () => {
    // Asserted on the chip rather than on the two strings separately: `—` appears on four of the
    // five chips today, so `toContain("—")` would pass just as happily with the release chip gone —
    // which is the one outcome §8.7 rules out.
    expect(header()).toMatch(/release <\/span><span[^>]*>—<\/span>/);
  });

  it("shows what PM2 says instead of a climbing uptime for a process that is not running", () => {
    // A stopped process keeps the start time of its last run, so an uptime computed from that alone
    // counts up all afternoon for something that stopped at lunch.
    const html = header({ process: { ...PROCESS, status: "stopped" } });

    expect(html).toContain("stopped");
    expect(html).toContain("bg-work-error-bg");
  });

  it("names dependencies as the service named them, and shows the endpoint's status", () => {
    const html = header();
    expect(html).toContain("db 1ms");
    expect(html).toContain("redis 1ms");
    expect(html).toContain("/health 200");
  });

  it("turns the restarts chip red above zero and leaves it calm at zero", () => {
    expect(header()).not.toContain("bg-work-error-bg");
    expect(header({ process: { ...PROCESS, restarts: 7 } })).toContain("bg-work-error-bg");
  });

  it("labels the signals toggle with what pressing it does, and says which state it is in", () => {
    // The state is on screen already; a button labelled with it is the one everybody presses twice
    // to find out. `aria-expanded` is what carries the state, for the reader who cannot see it.
    expect(header()).toContain('aria-expanded="true"');
    expect(header()).toContain("hide signals");

    expect(header(undefined, false)).toContain('aria-expanded="false"');
    expect(header(undefined, false)).toContain("show signals");
  });

  it("links a failed probe to the error logs around the moment it failed", () => {
    const html = header({
      probe: {
        status: "error",
        httpStatus: 502,
        latencyMs: 9,
        error: null,
        checkedAt: "2026-08-23T11:59:40Z",
        checks: [{ name: "db", status: "error", latencyMs: 1001 }],
      },
    });

    expect(html).toContain("/health 502");
    // Pinned to the two minutes around the probe, and still carrying the range it came from —
    // that is what the reader falls back to the moment they unpin the window.
    expect(html).toContain("/logs?service=pfa-nest-api&amp;level=error&amp;range=1h&amp;from=");
  });
});

describe("signal tiles", () => {
  it("answers an unscraped service with one sentence rather than four empty tiles", () => {
    const html = renderToStaticMarkup(
      h(Signals, {
        service: "bkmk-server",
        signals: signals({ scraped: false, source: "none" }),
        runtime: null,
        range: "1h",
        loading: false,
        runtimeLoading: false,
        error: null,
      }),
    );

    expect(html).toContain("No /metrics endpoint is registered");
    expect(html).not.toContain("THROUGHPUT");
  });

  it("draws the pool bar red and full at saturation, and names the waiters", () => {
    const html = renderToStaticMarkup(
      h(Signals, {
        service: "pfa-nest-api",
        signals: signals(),
        runtime: {
          heapUsedBytes: 3e8,
          heapTotalBytes: 4e8,
          eventLoopLagMs: 140,
          pool: { active: 10, idle: 0, waiting: 2 },
          observedAt: "2026-08-23T11:59:55Z",
        },
        range: "1h",
        loading: false,
        runtimeLoading: false,
        error: null,
      }),
    );

    expect(html).toContain("bg-work-error");
    expect(html).toContain("width:100%");
    expect(html).toContain("10/10 · 2 waiting");
    expect(html).toContain("140ms");
    expect(html).toContain("interpolated from prom-client buckets");
  });

  it("says where the older intervals came from, and links the error tile to the period", () => {
    const html = renderToStaticMarkup(
      h(Signals, {
        service: "pfa-nest-api",
        signals: signals({ source: "mixed" }),
        runtime: null,
        range: "7d",
        loading: false,
        runtimeLoading: false,
        error: null,
      }),
    );

    expect(html).toContain("older intervals read from hourly rollups");
    expect(html).toContain("/logs?service=pfa-nest-api&amp;level=error&amp;range=7d");
  });

  it("says the request failed rather than reporting the range as quiet", () => {
    // The one thing a monitoring tool must never do: render a network failure as "nothing
    // happened". The tile carries the API's own message instead.
    const html = renderToStaticMarkup(
      h(Signals, {
        service: "pfa-nest-api",
        signals: null,
        runtime: null,
        range: "1h",
        loading: false,
        runtimeLoading: false,
        error: "Could not read this service.",
      }),
    );

    expect(html).toContain("Could not read this service.");
    expect(html).not.toContain("No samples in this range.");
  });

  it("breaks the line at a hole instead of walking across it", () => {
    const html = renderToStaticMarkup(
      h(Signals, {
        service: "pfa-nest-api",
        signals: signals({
          p95: {
            value: 9.5,
            points: [
              { t: "a", v: 9 },
              { t: "b", v: 10 },
              { t: "c", v: null },
              { t: "d", v: 8 },
              { t: "e", v: 9 },
            ],
          },
        }),
        runtime: null,
        range: "1h",
        loading: false,
        runtimeLoading: false,
        error: null,
      }),
    );

    // Two polylines for one series: the run before the hole and the run after it.
    expect(html.match(/<polyline/g)?.length).toBe(2);
  });
});
