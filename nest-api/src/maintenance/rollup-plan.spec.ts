import { describe, expect, it } from "vitest";
import { dayChunks, pendingHours } from "./rollup-plan";

const at = (iso: string) => new Date(iso);

describe("pendingHours", () => {
  const now = at("2026-10-09T16:07:00.000Z");

  it("starts at the oldest raw hour on a first run and stops at the last finished one", () => {
    expect(pendingHours({ newest: null, now, rawWindowDays: 3 })).toEqual({
      from: at("2026-10-06T16:00:00.000Z"),
      to: at("2026-10-09T16:00:00.000Z"),
    });
  });

  it("resumes after the hour of the newest rollup, whose ts is that hour's last reading", () => {
    expect(pendingHours({ newest: at("2026-10-09T13:59:42.120Z"), now, rawWindowDays: 3 })).toEqual({
      from: at("2026-10-09T14:00:00.000Z"),
      to: at("2026-10-09T16:00:00.000Z"),
    });
  });

  it("catches up a long stop, but never before raw samples could still exist", () => {
    expect(pendingHours({ newest: at("2026-09-20T08:59:50.000Z"), now, rawWindowDays: 3 })?.from).toEqual(
      at("2026-10-06T16:00:00.000Z"),
    );
  });

  it("leaves an hour alone until its last scrape has had time to land", () => {
    const early = at("2026-10-09T16:01:00.000Z");
    expect(pendingHours({ newest: at("2026-10-09T14:59:45.000Z"), now: early, rawWindowDays: 3 })).toBeNull();
  });

  it("owes nothing when up to date", () => {
    expect(pendingHours({ newest: at("2026-10-09T15:59:45.000Z"), now, rawWindowDays: 3 })).toBeNull();
  });
});

describe("dayChunks", () => {
  it("cuts on UTC midnights, keeping both ends", () => {
    expect(dayChunks({ from: at("2026-10-07T22:00:00.000Z"), to: at("2026-10-09T03:00:00.000Z") })).toEqual([
      { from: at("2026-10-07T22:00:00.000Z"), to: at("2026-10-08T00:00:00.000Z") },
      { from: at("2026-10-08T00:00:00.000Z"), to: at("2026-10-09T00:00:00.000Z") },
      { from: at("2026-10-09T00:00:00.000Z"), to: at("2026-10-09T03:00:00.000Z") },
    ]);
  });

  it("is one chunk for one hour", () => {
    expect(dayChunks({ from: at("2026-10-09T15:00:00.000Z"), to: at("2026-10-09T16:00:00.000Z") })).toHaveLength(1);
  });
});
