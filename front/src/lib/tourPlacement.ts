import type { CardPlacement, Point, TourSide, TourStorage } from "@lib/interfaces/tourTypes";

/** The sides of its anchor a tour card can take. */
export const TOUR_SIDE = { right: "right", below: "below", above: "above", left: "left" } as const;

/** Namespaced like `iknos.tz` and `iknos.theme`. */
export const TOUR_STORAGE_KEY = "iknos.tour";

export const TOUR_DONE = "done";

/** Between the anchor and the card, and between the card and the viewport's edge. */
const GAP = 12;
const MARGIN = 16;

/** Tried in this order once the step's own side has no room. */
const FALLBACK: TourSide[] = [TOUR_SIDE.right, TOUR_SIDE.below, TOUR_SIDE.above, TOUR_SIDE.left];

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high));

/**
 * The card's top-left corner: beside the anchor, never over it, and inside the viewport.
 *
 * Each side puts the card a gap away from the anchor on one axis and slides it along the other to
 * stay on screen, so a side that fits cannot cover the anchor. The step's preferred side is taken
 * when it fits, then the others in a fixed order. On a viewport too small for any of them the
 * preferred spot is pulled back inside — covering part of the anchor beats a card off screen.
 */
export const placeCard = ({ anchor, card, viewport, prefer }: CardPlacement) => {
  const maxX = viewport.width - card.width - MARGIN;
  const maxY = viewport.height - card.height - MARGIN;
  const alongX = clamp(anchor.x, MARGIN, maxX);
  const alongY = clamp(anchor.y, MARGIN, maxY);
  const spots: Record<TourSide, Point> = {
    [TOUR_SIDE.right]: { x: anchor.x + anchor.width + GAP, y: alongY },
    [TOUR_SIDE.below]: { x: alongX, y: anchor.y + anchor.height + GAP },
    [TOUR_SIDE.above]: { x: alongX, y: anchor.y - GAP - card.height },
    [TOUR_SIDE.left]: { x: anchor.x - GAP - card.width, y: alongY },
  };
  const fits = (spot: Point) => spot.x >= MARGIN && spot.x <= maxX && spot.y >= MARGIN && spot.y <= maxY;
  const side = [prefer, ...FALLBACK].find((candidate) => fits(spots[candidate]));
  if (side) return spots[side];
  return { x: clamp(spots[prefer].x, MARGIN, maxX), y: clamp(spots[prefer].y, MARGIN, maxY) };
};

/** Whether this reader already closed the tour. Storage can be missing or throw: then show it. */
export const tourDone = (storage: TourStorage | undefined) => {
  try {
    return storage?.getItem(TOUR_STORAGE_KEY) === TOUR_DONE;
  } catch {
    return false;
  }
};

export const rememberTourDone = (storage: TourStorage | undefined) => {
  try {
    storage?.setItem(TOUR_STORAGE_KEY, TOUR_DONE);
  } catch {
    // Safari's private mode, or blocked storage: the tour comes back next time, nothing worse.
  }
};

/** The page's local storage, or nothing where the browser refuses it (the getter itself can throw). */
export const browserStorage = (): TourStorage | undefined => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};
