import { describe, expect, it } from "vitest";
import { EventCap } from "./event-cap";

/**
 * The cap decides how many `issue_event` rows an error in a loop may leave behind. It must never
 * decide how many times that error *happened* — `issue.event_count` is applied by the upsert
 * whatever this answers, and the two are separate on purpose (IKN-9 §5).
 */

const MINUTE = 60_000;
const T0 = Date.UTC(2026, 7, 25, 2, 14, 0);

describe("EventCap", () => {
  it("allows up to the ceiling within one minute and refuses the rest", () => {
    const cap = new EventCap(3);
    const taken = Array.from({ length: 10 }, (_, i) => cap.allow("abc", T0 + i));
    expect(taken).toEqual([true, true, true, false, false, false, false, false, false, false]);
  });

  it("starts fresh in the next minute", () => {
    const cap = new EventCap(2);
    cap.allow("abc", T0);
    cap.allow("abc", T0);
    expect(cap.allow("abc", T0)).toBe(false);
    expect(cap.allow("abc", T0 + MINUTE)).toBe(true);
  });

  it("counts each fingerprint on its own budget", () => {
    // One loud error must not silence a quiet one that happened to share its minute.
    const cap = new EventCap(1);
    expect(cap.allow("loud", T0)).toBe(true);
    expect(cap.allow("loud", T0)).toBe(false);
    expect(cap.allow("quiet", T0)).toBe(true);
  });

  it("keeps answering after the map has been swept", () => {
    // Fingerprints are hashes and a pathological workload could mint them forever, so the map is
    // swept rather than trusted. A sweep must not lose the minute a live fingerprint is in.
    const cap = new EventCap(1);
    for (let i = 0; i < 5_000; i += 1) cap.allow(`fp-${i}`, T0);

    expect(cap.allow("fp-0", T0 + MINUTE)).toBe(true);
    expect(cap.allow("fp-0", T0 + MINUTE)).toBe(false);
  });

  it("treats a ceiling of zero as writing no samples at all", () => {
    // The ceiling is checked before a slot is booked. Checking it after would let the first
    // occurrence of every minute through a cap that was set to refuse everything — counting
    // stays exact either way, but "zero" should mean zero.
    const cap = new EventCap(0);
    expect(cap.allow("abc", T0)).toBe(false);
    expect(cap.allow("abc", T0 + MINUTE)).toBe(false);
  });
});
