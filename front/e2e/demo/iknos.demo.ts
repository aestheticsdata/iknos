import { expect, test } from "@e2e/demo/fixture";

import type { Locator } from "@playwright/test";

/**
 * Iknos, end to end — one continuous take, five chapters, three screens and their modals.
 *
 * This file is the storyboard and nothing else: no pointer paths, no video, no timing arithmetic.
 * Those live in `cursor.ts`, `fixture.ts` and `pacing.ts`, so what is left here reads as a shot
 * list and can be reordered by moving blocks around.
 *
 * Four rules it never breaks.
 *
 * NOTHING IS TOUCHED. The take is read-only — no resolve, ignore, reopen, acknowledge, silence,
 * filter removed, nothing copied to the clipboard, nobody signed out — which is why there is no
 * `arrange.ts` beside this file. The dangerous keys are global: ⌘⇧L signs out, ⌘C copies the
 * selected row. Nothing is typed outside the palette's input.
 *
 * NOTHING IS ASSERTED THAT MOVES. Every timestamp, every `N ago`, the recency dots, the collector
 * pill, the rail sparklines, the health pills, the runtime tile and the status bar's `q Nms` are
 * live — the fake fleet IKN-64 writes under the camera, and the alert engine opens alerts of its
 * own. Waits are on a message, a trace, a fingerprint, a rule title: the fixture half of IKN-61.
 *
 * NO URL IS EVER TYPED, except the first. Everything after `/logs/` is reached by clicking — the
 * rail, a tile that is itself a link, a bucket, a card.
 *
 * MODALS ARE THE TOP LAYER. Every dialog here is a native `<dialog>` opened with `showModal()`,
 * and six of them are mounted CLOSED on every route with their last content latched. So a modal is
 * only ever addressed as `dialog[open]` under its own name, and Escape — which the browser handles
 * natively, innermost first — is how each one closes.
 *
 * The one real cost, stated: Iknos has a single account and a single live session. The setup
 * project's sign-in revoked yours. That is in the README.
 */

/**
 * The through-line: the corpus's incident service. A 5xx burst four days back, a Redis outage
 * and a restart three hours back, `restarts 7` on its chip, the 49-count `FetchError` issue, and
 * the one critical alert whose state band has transitions.
 */
const SERVICE = "beacon-api";

/** Its recurring error — the fixture line the detail and the trace are opened from. */
const ERROR_LINE = "FetchError: forecast upstream request timed out";

/**
 * Its grouped issue. ⚠️ A fingerprint is computed from the error template by the production
 * `fingerprintOf`, so it changes whenever the corpus's stack paths do — this one is from the
 * corpus as re-authored for IKN-67 (`pnpm mock:author` prints the digest).
 */
const ISSUE = "6ca3eb803cff06f6";

/** The alert opened in chapter 5 — the only fixture episode inside the state band's 6-hour window. */
const ALERT_RULE = "health_down";

test("keystone, end to end", async ({ demo }) => {
  const page = demo.page;

  /** A dialog by name — and only while open, because a closed one is still in the DOM. */
  const modal = (name: string) => page.locator(`dialog[open][data-testid="${name}"]`);
  const railRow = (service: string) => page.locator(`[data-testid="rail-row"][data-service="${service}"]`);
  const railView = (view: string) => page.locator(`[data-testid="rail-view-link"][data-view="${view}"]`);

  /** Walk the pointer along a family of marks, pausing on each. */
  const sweep = async (marks: Locator, positions: number[], hold: number) => {
    for (const index of positions) {
      await demo.moveTo(marks.nth(index), { dwell: hold });
    }
  };

  /**
   * Walk the pointer across an svg that resolves its bubble from the pointer's x — the sparklines
   * and area charts have no per-point elements, one listener on the svg. Five stops, left to right.
   */
  const sweepChart = async (chart: Locator, hold: number) => {
    const box = await chart.boundingBox();
    if (!box) throw new Error("demo: the chart has no box to sweep");
    for (const fraction of [0.08, 0.3, 0.52, 0.74, 0.94]) {
      await demo.park(box.x + box.width * fraction, box.y + box.height * 0.55);
      await demo.dwell(hold);
    }
  };

  // ── 1 ── The fleet at a glance ───────────────────────────────────────────
  await demo.open("/logs/");
  await demo.chapter("The fleet at a glance");

  await expect(railRow(SERVICE)).toBeVisible();
  demo.shot("logs");
  await demo.dwell(1800);

  // The rail: nineteen services, a sparkline of the last hour beside each.
  await demo.moveTo(railRow("atlas-api"), { dwell: 700 });
  await demo.moveTo(railRow(SERVICE), { dwell: 700 });
  await demo.dwell(700);

  // The histogram: one real button per bucket, so a sweep walks the bubble across the week.
  const buckets = page.getByTestId("histogram-bucket");
  const bucketCount = await buckets.count();
  const stops = [0.06, 0.26, 0.48, 0.7, 0.93].map((f) => Math.min(bucketCount - 1, Math.floor(bucketCount * f)));
  await sweep(buckets, stops, 620);
  await demo.dwell(700);

  // The anomaly marker, when the range has one — the burst at −4 d gives it on 7d.
  const anomaly = page.getByTestId("histogram-anomaly");
  if ((await anomaly.count()) > 0) {
    await demo.moveTo(anomaly.first(), { dwell: 900 });
    await demo.dwell(900);
  }

  // A bucket pins the window; the badge says so; `back to the range` undoes it. URL only.
  await demo.click(buckets.nth(stops[2]));
  await expect(page.getByTestId("pinned-badge")).toBeVisible();
  await demo.dwell(1600);
  await demo.click(page.getByTestId("unpin"));
  await demo.dwell(900);

  await demo.click(page.locator('[data-testid="range-button"][data-range="24h"]'));
  await demo.dwell(1600);
  await demo.click(page.locator('[data-testid="range-button"][data-range="7d"]'));
  await demo.dwell(1100);

  // The stream owns its own scroller; pausing it is what scrolling away does.
  const stream = page.getByTestId("stream-scroll");
  await demo.scroll(stream, 620, 1100);
  await demo.dwell(1100);
  await demo.scroll(stream, -620, 1000);
  await demo.dwell(700);

  // ⌘K, and the one thing this take types outside a field: a service name.
  await demo.press("Control+K");
  const palette = modal("palette");
  await expect(palette).toBeVisible();
  await demo.dwell(700);
  await demo.type("beacon");
  const hit = palette.locator('[data-testid="palette-row"]', { hasText: SERVICE }).first();
  await expect(hit).toBeVisible();
  await demo.dwell(1100);
  await demo.click(hit, { aim: "text" });
  await expect(page.getByTestId("service-header")).toBeVisible();
  await demo.dwell(900);

  // ── 2 ── One service ─────────────────────────────────────────────────────
  await demo.chapter("One service");
  demo.shot("service");
  await demo.dwell(1200);

  const header = page.getByTestId("service-header");
  await sweep(header.getByTestId("service-chip"), [0, 1, 3, 4], 600);
  await demo.dwell(500);
  await sweep(header.getByTestId("health-pill"), [0, 1, 2], 650);
  await demo.dwell(800);

  // Four tiles: the header of each carries a bubble, the chart under three of them resolves a
  // point from the pointer, the fourth is two meters.
  // ⚠️ `tile-header` exists only while the tile has a hint to show — the p95 tile before its
  // reference lands, and the runtime tile without a heap total, render their header bare. The
  // pointer goes to the tile itself then, so a take never waits on a bubble that was never coming.
  const tiles = page.getByTestId("signal-tile");
  for (const index of [0, 1, 2]) {
    const tile = tiles.nth(index);
    const header = tile.getByTestId("tile-header");
    await demo.moveTo((await header.count()) > 0 ? header : tile, { dwell: 700 });
    await sweepChart(tile.getByTestId("tile-chart"), 450);
    await demo.dwell(500);
  }
  await sweep(page.getByTestId("meter-row"), [0, 1], 800);
  await demo.dwell(700);

  await demo.click(page.getByTestId("signals-toggle"));
  await demo.dwell(1500);
  await demo.click(page.getByTestId("signals-toggle"));
  await demo.dwell(1000);

  // The right-hand column: what fired, and what keeps happening.
  await demo.moveTo(page.getByTestId("alerts-panel"), { dwell: 600 });
  await demo.moveTo(page.getByTestId("issue-row-compact").first(), { aim: "text", dwell: 900 });
  await demo.dwell(900);

  // ── 3 ── A line, its detail, its trace ───────────────────────────────────
  await demo.chapter("A line, its detail, its trace");

  // ⚠️ The ERROR RATE tile is itself a link — to this service's error lines. Read-only, URL only,
  // and it is what brings the corpus's traced errors to the top of the stream.
  await demo.click(tiles.nth(1));
  // ⚠️ The first such row is usually the fake fleet's — written a minute ago, and without a trace.
  // The fixture's carry one (17 of them), and the trace cell is what chapter 3 is for, so the row
  // is the first that HAS one.
  const errorRow = page
    .locator('[data-testid="log-row"]', { hasText: ERROR_LINE })
    .filter({ has: page.getByTestId("log-trace") })
    .first();
  await expect(errorRow).toBeVisible();
  demo.shot("errors");
  await demo.dwell(1500);

  // The whole row opens the detail. Aimed at its leading edge — the time cell.
  await demo.click(errorRow, { aim: "text" });
  const detail = modal("row-detail");
  await expect(detail).toBeVisible();
  await demo.dwell(2000);
  // ⚠️ Hovered for its bubble, never pressed: it writes the clipboard. An error line carries no
  // client address, so on this row the glyph is absent — the pointer reads the fields instead.
  const ipCopy = detail.getByTestId("ip-copy");
  await demo.moveTo((await ipCopy.count()) > 0 ? ipCopy : detail.getByTestId("detail-field").nth(1), { dwell: 900 });
  await demo.moveTo(detail.getByTestId("detail-field").last(), { dwell: 700 });
  await demo.dwell(1000);
  await demo.press("Escape");
  await expect(detail).toHaveCount(0);
  await demo.dwell(700);

  // The trace cell stops propagation — it opens the timeline, not the detail.
  await demo.click(errorRow.getByTestId("log-trace"));
  const trace = modal("trace-timeline");
  await expect(trace).toBeVisible();
  await demo.dwell(1600);
  const lanes = trace.getByTestId("trace-lane");
  const laneCount = await lanes.count();
  await sweep(lanes, [...Array(Math.min(laneCount, 6)).keys()], 520);
  await demo.dwell(1400);
  await demo.press("Escape");
  await expect(trace).toHaveCount(0);
  await demo.dwell(800);

  // ── 4 ── Issues ──────────────────────────────────────────────────────────
  await demo.chapter("Issues");

  // The rail link carries the scope: this service's issues first.
  await demo.click(railView("issues"));
  await expect(page.getByTestId("issues-view")).toBeVisible();
  demo.shot("issues");
  await demo.dwell(1500);

  await demo.click(page.locator('[data-testid="issues-segment"][data-segment="resolved"]'));
  await demo.dwell(1400);
  await demo.click(page.locator('[data-testid="issues-segment"][data-segment="unresolved"]'));
  await demo.dwell(1000);
  await demo.click(page.locator('[data-testid="issues-sort"][data-sort="volume"]'));
  await demo.dwell(1200);
  await demo.moveTo(page.getByTestId("issue-spark").first(), { dwell: 900 });
  await demo.dwell(700);

  // ⚠️ The modal's footer is `resolve` / `ignore` / `reopen`. The tiles are read, the stack is
  // read, and it closes by the keyboard.
  await demo.click(page.locator(`[data-testid="issue-open"][data-fingerprint="${ISSUE}"]`), { aim: "text" });
  const issue = modal("issue-modal");
  await expect(issue).toBeVisible();
  await demo.dwell(1600);
  await sweep(issue.getByTestId("issue-tile"), [0, 1, 2, 4], 600);
  await demo.dwell(1600);
  await demo.press("Escape");
  await expect(issue).toHaveCount(0);
  await demo.dwell(700);

  // Fleet-wide: the rail's `all`, and the regressions among the unresolved.
  await demo.click(railRow("all"));
  await expect(page.getByTestId("issue-open").first()).toBeVisible();
  await demo.dwell(1800);

  // ── 5 ── Alerts ──────────────────────────────────────────────────────────
  await demo.chapter("Alerts");

  // /alerts opens on `firing`, which the fixture leaves empty on purpose — nothing is burning.
  // The story is in `resolved`.
  await demo.click(railView("alerts"));
  await expect(page.getByTestId("alerts-view")).toBeVisible();
  await demo.dwell(1300);
  await demo.click(page.locator('[data-testid="alerts-state"][data-state="resolved"]'));
  await expect(page.getByTestId("alert-card").first()).toBeVisible();
  demo.shot("alerts");
  await demo.dwell(1400);
  await demo.click(page.locator('[data-testid="alerts-severity"][data-severity="critical"]'));
  await demo.dwell(1300);

  const alertsScroll = page.getByTestId("alerts-scroll");
  await demo.scroll(alertsScroll, 400, 1100);
  await demo.dwell(900);
  await demo.scroll(alertsScroll, -400, 1000);
  await demo.dwell(600);

  // The card is found by its rule and its service, never by its id — ids are minted on every
  // load — and not by its title either: a card prints the rule's expression, the title is the
  // modal's.
  const card = page.locator(`[data-testid="alert-card"][data-rule="${ALERT_RULE}"]`, { hasText: SERVICE }).first();
  await demo.click(card, { aim: "text" });
  const alert = modal("alert-modal");
  await expect(alert).toBeVisible();
  await demo.dwell(1600);
  await sweep(alert.getByTestId("alert-tile"), [0, 1, 2, 3], 600);
  const segments = alert.getByTestId("state-band-segment");
  const segmentCount = await segments.count();
  if (segmentCount > 0) {
    await sweep(segments, [...Array(Math.min(segmentCount, 5)).keys()], 600);
  }
  await demo.dwell(1200);

  // Out through the alert's own door: the logs of that period, on the explorer where it started.
  await demo.click(alert.getByTestId("alert-open-logs"), { aim: "text" });
  await expect(page.getByTestId("stream-scroll")).toBeVisible();
  await demo.dwell(1600);

  await demo.park();
  await demo.dwell(1400);
});
