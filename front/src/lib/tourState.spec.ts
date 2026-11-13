import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOUR_DONE, TOUR_STORAGE_KEY } from "./tourPlacement";

/**
 * The store reads `localStorage` once, the first time it is asked, and keeps the answer in the
 * module — so each case stubs the storage and imports a fresh copy.
 */
const load = async (stored: Record<string, string> = {}) => {
  const store = new Map(Object.entries(stored));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  });
  vi.resetModules();
  return { store, tour: await import("./tourState") };
};

describe("the tour's state", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("opens on the first step for a reader who has not seen it", async () => {
    const { tour } = await load();
    expect(tour.currentTour()).toEqual({ step: 0, leaving: false });
  });

  it("stays closed once the flag is stored, and on the server", async () => {
    const { tour } = await load({ [TOUR_STORAGE_KEY]: TOUR_DONE });
    expect(tour.currentTour().step).toBeNull();
    expect(tour.closedTour().step).toBeNull();
  });

  it("walks every step, then closes and remembers", async () => {
    const { store, tour } = await load();
    const seen = vi.fn();
    tour.subscribeTour(seen);
    for (let step = 1; step < tour.TOUR_STEPS.length; step++) {
      tour.advanceTour();
      expect(tour.currentTour().step).toBe(step);
    }
    expect(store.has(TOUR_STORAGE_KEY)).toBe(false);

    tour.advanceTour();
    // The flag is written before the fade, so a reload in between does not bring the card back.
    expect(store.get(TOUR_STORAGE_KEY)).toBe(TOUR_DONE);
    expect(tour.currentTour()).toEqual({ step: tour.TOUR_STEPS.length - 1, leaving: true });
    vi.runAllTimers();
    expect(tour.currentTour().step).toBeNull();
    expect(seen).toHaveBeenCalledTimes(tour.TOUR_STEPS.length + 1);
  });

  it("closes from any step when skipped, and ignores a second press during the fade", async () => {
    const { store, tour } = await load();
    tour.advanceTour();
    tour.endTour();
    tour.advanceTour();
    tour.endTour();
    expect(tour.currentTour()).toEqual({ step: 1, leaving: true });
    vi.runAllTimers();
    expect(tour.currentTour().step).toBeNull();
    expect(store.get(TOUR_STORAGE_KEY)).toBe(TOUR_DONE);
  });

  it("names a different control at every step", async () => {
    const { tour } = await load();
    const anchors = tour.TOUR_STEPS.map((step) => step.anchor);
    expect(new Set(anchors).size).toBe(anchors.length);
    expect(tour.nextTourStep(0, 2)).toBe(1);
    expect(tour.nextTourStep(1, 2)).toBeNull();
  });
});
