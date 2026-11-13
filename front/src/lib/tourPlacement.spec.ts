import { describe, expect, it } from "vitest";
import { placeCard, rememberTourDone, TOUR_DONE, TOUR_SIDE, TOUR_STORAGE_KEY, tourDone } from "./tourPlacement";

import type { Box } from "./interfaces/tourTypes";

const viewport = { width: 1440, height: 900 };
const card = { width: 320, height: 184 };

/** The chassis at 1440×900: a 36px top bar, a 188px rail under it. */
const services: Box = { x: 8, y: 48, width: 172, height: 420 };
const range: Box = { x: 1150, y: 9, width: 140, height: 18 };
const ingest: Box = { x: 12, y: 780, width: 164, height: 56 };

const overlaps = (at: { x: number; y: number }, anchor: Box) =>
  at.x < anchor.x + anchor.width &&
  at.x + card.width > anchor.x &&
  at.y < anchor.y + anchor.height &&
  at.y + card.height > anchor.y;

describe("the tour card's place", () => {
  it("goes right of a rail anchor, level with its top", () => {
    expect(placeCard({ anchor: services, card, viewport, prefer: TOUR_SIDE.right })).toEqual({ x: 192, y: 48 });
  });

  it("goes below a top-bar anchor, pulled back inside the right edge", () => {
    expect(placeCard({ anchor: range, card, viewport, prefer: TOUR_SIDE.below })).toEqual({ x: 1104, y: 39 });
  });

  it("stays inside the viewport beside an anchor at the foot of the rail", () => {
    expect(placeCard({ anchor: ingest, card, viewport, prefer: TOUR_SIDE.right })).toEqual({ x: 188, y: 700 });
  });

  it("falls back to another side when the preferred one has no room", () => {
    // Nothing fits right of the range buttons, so the card drops below them.
    expect(placeCard({ anchor: range, card, viewport, prefer: TOUR_SIDE.right })).toEqual({ x: 1104, y: 39 });
    // Nothing fits below the ingest card, so the card goes to its right.
    expect(placeCard({ anchor: ingest, card, viewport, prefer: TOUR_SIDE.below })).toEqual({ x: 188, y: 700 });
  });

  it("goes above, then left, when those are the sides left", () => {
    const corner: Box = { x: 1300, y: 860, width: 120, height: 24 };
    expect(placeCard({ anchor: corner, card, viewport, prefer: TOUR_SIDE.right })).toEqual({ x: 1104, y: 664 });
    const tall: Box = { x: 1300, y: 0, width: 140, height: 900 };
    expect(placeCard({ anchor: tall, card, viewport, prefer: TOUR_SIDE.below })).toEqual({ x: 968, y: 16 });
  });

  it("never covers its anchor on any side that fits", () => {
    for (const anchor of [services, range, ingest]) {
      for (const prefer of Object.values(TOUR_SIDE)) {
        expect(overlaps(placeCard({ anchor, card, viewport, prefer }), anchor)).toBe(false);
      }
    }
  });

  it("is pulled back inside a viewport too small for any side", () => {
    const small = { width: 360, height: 300 };
    const anchor: Box = { x: 20, y: 60, width: 320, height: 200 };
    expect(placeCard({ anchor, card, viewport: small, prefer: TOUR_SIDE.right })).toEqual({ x: 24, y: 60 });
  });
});

describe("the tour's memory", () => {
  it("remembers a closed tour under iknos.tour", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    expect(TOUR_STORAGE_KEY).toBe("iknos.tour");
    expect(tourDone(storage)).toBe(false);
    rememberTourDone(storage);
    expect(store.get(TOUR_STORAGE_KEY)).toBe(TOUR_DONE);
    expect(tourDone(storage)).toBe(true);
  });

  it("shows the tour when storage is missing or throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(tourDone(broken)).toBe(false);
    expect(() => rememberTourDone(broken)).not.toThrow();
    expect(tourDone(undefined)).toBe(false);
  });
});
