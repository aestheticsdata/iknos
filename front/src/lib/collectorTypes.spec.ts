import { describe, expect, it } from "vitest";
import { ageOfPoll, healthOf, LAG_WARN_MS, POLL_STALE_MS, WRITE_STALL_MS } from "./collectorTypes";

import type { CollectorStatus } from "./collectorTypes";

const T = Date.parse("2026-08-21T12:00:00Z");

const status = (over: Partial<CollectorStatus> = {}): CollectorStatus => ({
  lagMs: 400,
  lastWrittenAt: new Date(T).toISOString(),
  lastPollAt: new Date(T).toISOString(),
  written: 100,
  dropped: 0,
  degraded: 0,
  queued: 0,
  bytesRead: 4096,
  rate: null,
  files: [],
  observedAt: new Date(T).toISOString(),
  meta: { tookMs: 1 },
  ...over,
});

/**
 * The pastille is the only place in the interface where "the collector is dead" is visible, so
 * what it must never do is look healthy when it does not know. These cases are the ones that
 * distinguish the three ways of knowing nothing.
 */
describe("healthOf", () => {
  it("is neutral before the first answer, not green", () => {
    expect(healthOf(null, 0, 0)).toBe("unknown");
  });

  it("is neutral when the collector has not completed a pass yet", () => {
    // A cold start: the process is up, the tailer has not finished its first sweep.
    expect(healthOf(status({ lastPollAt: null, lagMs: null }), T, T)).toBe("unknown");
  });

  it("is green on a fresh heartbeat and ordinary lag", () => {
    expect(healthOf(status(), T, T)).toBe("ok");
  });

  it("goes amber past the lag threshold", () => {
    expect(healthOf(status({ lagMs: LAG_WARN_MS + 1 }), T, T)).toBe("warn");
  });

  it("does not go amber for a stall this host is entitled to have", () => {
    expect(healthOf(status({ lagMs: 2_000 }), T, T)).toBe("ok");
  });

  it("goes red once the heartbeat is stale, whatever the last lag reading said", () => {
    // The frozen lag reading is the trap: it is the healthy value measured just before everything
    // stopped, and reading it alone would show a perfectly green pastille over a dead collector.
    const health = healthOf(status({ lagMs: 300 }), T, T + POLL_STALE_MS + 1);
    expect(health).toBe("down");
  });

  it("does not colour on dropped lines, which are cumulative and never reset", () => {
    expect(healthOf(status({ dropped: 12_000 }), T, T)).toBe("ok");
  });

  it("goes amber when lines are queued and nothing is being written", () => {
    // A database outage seen from here: the tailer polls happily, the writer fails every batch.
    // Every other signal on the payload stays reassuring, which is what makes this worth checking.
    const stalled = status({
      queued: 4_000,
      lagMs: 300,
      lastWrittenAt: new Date(T - WRITE_STALL_MS - 1_000).toISOString(),
      observedAt: new Date(T).toISOString(),
      lastPollAt: new Date(T).toISOString(),
    });
    expect(healthOf(stalled, T, T)).toBe("warn");
  });

  it("goes amber when there is a queue and nothing has ever been written", () => {
    expect(healthOf(status({ queued: 200, lastWrittenAt: null, lagMs: null }), T, T)).toBe("warn");
  });

  it("leaves an ordinary in-flight queue alone", () => {
    // Every line spends its first half-second here. A queue is not a fault.
    const busy = status({
      queued: 180,
      lastWrittenAt: new Date(T - 400).toISOString(),
      observedAt: new Date(T).toISOString(),
    });
    expect(healthOf(busy, T, T)).toBe("ok");
  });
});

describe("ageOfPoll", () => {
  it("ages the heartbeat by locally-measured time, not by the browser's wall clock", () => {
    const s = status({
      lastPollAt: new Date(T).toISOString(),
      observedAt: new Date(T + 500).toISOString(),
    });

    // The browser clock is an hour behind the server's. The answer must not notice.
    const receivedAt = T - 3_600_000;
    expect(ageOfPoll(s, receivedAt, receivedAt + 2_000)).toBe(2_500);
  });

  it("says nothing when there is no heartbeat to age", () => {
    expect(ageOfPoll(status({ lastPollAt: null }), T, T)).toBeNull();
  });
});
